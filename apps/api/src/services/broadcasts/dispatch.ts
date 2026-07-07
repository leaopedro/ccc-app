import { prisma } from '@jdm/db';
import {
  notificationDestinationSchema,
  type NotificationDestination,
} from '@jdm/shared/notifications';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import type { PushSender } from '../push/index.js';

import { resolveAudience } from './targets.js';

const CHUNK = 100;

export type DispatchDeps = {
  sender: PushSender;
  batchSize?: number;
  log?: FastifyBaseLogger;
  now?: Date;
};

const parseDestination = (raw: Prisma.JsonValue | null): NotificationDestination | null => {
  if (!raw) return null;
  const parsed = notificationDestinationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const buildPushData = (
  notificationId: string,
  baseData: Record<string, unknown>,
  destination: NotificationDestination | null,
): Record<string, unknown> => ({
  ...baseData,
  route: 'notifications',
  notificationId,
  ...(destination ? { destination } : {}),
});

/**
 * Claim and dispatch one due broadcast per tick.
 *
 * Every audience member receives a Notification inbox row regardless of
 * delivery mode. Push is emitted only when `deliveryMode === 'in_app_plus_push'`
 * and the recipient is marketing-opted-in with at least one token.
 *
 * Idempotency: BroadcastDelivery rows guard against duplicate per-recipient
 * processing, and Notification dedupe is (userId, 'broadcast', broadcastId).
 */
export const runBroadcastDispatchTick = async (deps: DispatchDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const batchSize = deps.batchSize ?? CHUNK;
  const log = deps.log;

  const broadcast = await prisma.broadcast.findFirst({
    where: {
      status: 'scheduled',
      scheduledAt: { not: null, lte: now },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  if (!broadcast) return;

  const claimed = await prisma.broadcast.updateMany({
    where: {
      id: broadcast.id,
      status: 'scheduled',
      scheduledAt: { not: null, lte: now },
    },
    data: { status: 'processing', startedAt: now },
  });

  if (claimed.count === 0) return;

  log?.info({ broadcastId: broadcast.id }, '[broadcasts] claimed broadcast for dispatch');

  try {
    const targetKind = broadcast.targetKind;
    const targetValue = broadcast.targetValue;

    type Target =
      | { kind: 'all' }
      | { kind: 'premium' }
      | { kind: 'attendees_of_event'; eventId: string }
      | { kind: 'city'; city: string };

    let target: Target;
    if (targetKind === 'attendees_of_event') {
      target = { kind: 'attendees_of_event', eventId: targetValue! };
    } else if (targetKind === 'city') {
      target = { kind: 'city', city: targetValue! };
    } else {
      target = { kind: targetKind };
    }

    const audience = await resolveAudience(target);
    const destination = parseDestination(broadcast.destination);
    const baseData = (broadcast.data ?? {}) as Record<string, unknown>;

    // Insert delivery rows idempotently before sending
    await prisma.broadcastDelivery.createMany({
      data: audience.map((r) => ({ broadcastId: broadcast.id, userId: r.userId })),
      skipDuplicates: true,
    });

    // Mint inbox rows for the full audience. Dedupe via the existing
    // (userId, kind, dedupeKey) unique index so retries don't duplicate.
    const destinationJson = destination ? (destination as Prisma.InputJsonValue) : Prisma.JsonNull;
    await prisma.notification.createMany({
      data: audience.map((r) => ({
        userId: r.userId,
        kind: 'broadcast',
        dedupeKey: broadcast.id,
        title: broadcast.title,
        body: broadcast.body,
        data: baseData as Prisma.InputJsonValue,
        destination: destinationJson,
      })),
      skipDuplicates: true,
    });

    // Link delivery -> notification for traceability.
    const notifications = await prisma.notification.findMany({
      where: {
        userId: { in: audience.map((r) => r.userId) },
        kind: 'broadcast',
        dedupeKey: broadcast.id,
      },
      select: { id: true, userId: true },
    });
    const notifByUser = new Map(notifications.map((n) => [n.userId, n.id] as const));

    for (const r of audience) {
      const notificationId = notifByUser.get(r.userId);
      if (notificationId) {
        await prisma.broadcastDelivery.updateMany({
          where: {
            broadcastId: broadcast.id,
            userId: r.userId,
            notificationId: null,
          },
          data: { notificationId },
        });
      }
    }

    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    const pushEligible =
      broadcast.deliveryMode === 'in_app_plus_push'
        ? audience.filter((r) => r.marketingOptedIn && r.tokens.length > 0)
        : [];

    if (broadcast.deliveryMode === 'in_app_only') {
      // Inbox-only: mark every delivery as sent (the inbox row is the delivery).
      await prisma.broadcastDelivery.updateMany({
        where: { broadcastId: broadcast.id, status: 'pending' },
        data: { status: 'sent', sentAt: now, attemptCount: 1, lastAttemptAt: now },
      });
      totalSent = audience.length;
    } else {
      // Audience members not push-eligible: mark skipped (inbox row still exists).
      const eligibleIds = new Set(pushEligible.map((r) => r.userId));
      const skipped = audience.filter((r) => !eligibleIds.has(r.userId));
      if (skipped.length > 0) {
        await prisma.broadcastDelivery.updateMany({
          where: { broadcastId: broadcast.id, userId: { in: skipped.map((r) => r.userId) } },
          data: { status: 'skipped', attemptCount: 1, lastAttemptAt: now },
        });
        totalSkipped = skipped.length;
      }

      for (let i = 0; i < pushEligible.length; i += batchSize) {
        const chunk = pushEligible.slice(i, i + batchSize);

        const messages = chunk.flatMap((r) => {
          const notificationId = notifByUser.get(r.userId);
          if (!notificationId) return [];
          const pushData = buildPushData(notificationId, baseData, destination);
          return r.tokens.map((token) => ({
            to: token,
            title: broadcast.title,
            body: broadcast.body,
            data: pushData,
          }));
        });

        const result = await deps.sender.send(messages);

        const invalidTokens: string[] = [];
        for (const r of chunk) {
          const outcomes = r.tokens.map((t) => result.outcomesByToken.get(t));
          const hasSent = outcomes.some((o) => o?.kind === 'ok');
          const allInvalid = outcomes.every((o) => o?.kind === 'invalid-token');

          if (allInvalid) {
            invalidTokens.push(...r.tokens);
          }

          await prisma.broadcastDelivery.updateMany({
            where: { broadcastId: broadcast.id, userId: r.userId },
            data: {
              status: hasSent ? 'sent' : 'failed',
              sentAt: hasSent ? new Date() : null,
              attemptCount: { increment: 1 },
              lastAttemptAt: new Date(),
              failureCode: hasSent ? null : 'send_error',
              failureMessage: hasSent
                ? null
                : (outcomes.find((o) => o?.kind === 'error')?.message ?? null),
            },
          });

          if (hasSent) totalSent++;
          else totalFailed++;
        }

        if (invalidTokens.length > 0) {
          await prisma.deviceToken.deleteMany({
            where: { expoPushToken: { in: invalidTokens } },
          });
          log?.info({ count: invalidTokens.length }, '[broadcasts] pruned invalid tokens');
        }
      }
    }

    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'sent', completedAt: new Date() },
    });

    log?.info(
      { broadcastId: broadcast.id, totalSent, totalFailed, totalSkipped },
      '[broadcasts] dispatch complete',
    );
  } catch (err) {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'failed', completedAt: new Date() },
    });
    log?.error({ broadcastId: broadcast.id, err }, '[broadcasts] dispatch failed');
    throw err;
  }
};
