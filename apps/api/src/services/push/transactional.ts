import { prisma } from '@ccc/db';
import type { NotificationDestination } from '@ccc/shared/notifications';
import type { PushKind } from '@ccc/shared/push';
import { Prisma } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

import type { PushMessage, PushSender } from './types.js';

export type SendTransactionalPushInput = {
  userId: string;
  kind: PushKind;
  dedupeKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  destination?: NotificationDestination;
};

export type SendTransactionalPushResult = {
  deduped: boolean;
  sent: number;
  invalidatedTokens: number;
};

const buildPushDataFromRow = (n: {
  id: string;
  data: Prisma.JsonValue;
  destination: Prisma.JsonValue | null;
}): Record<string, unknown> => ({
  ...((n.data as Record<string, unknown> | null) ?? {}),
  route: 'notifications',
  notificationId: n.id,
  ...(n.destination ? { destination: n.destination } : {}),
});

export const enqueueNotification = async (
  input: SendTransactionalPushInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ deduped: true } | { deduped: false; id: string }> => {
  try {
    const n = await client.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        destination: input.destination
          ? (input.destination as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      select: { id: true },
    });
    return { deduped: false, id: n.id };
  } catch (err) {
    if (isUniqueConstraintError(err)) return { deduped: true };
    throw err;
  }
};

export const deliverNotification = async (
  notificationId: string,
  deps: { sender: PushSender; now?: Date },
): Promise<{
  sent: number;
  invalidatedTokens: number;
  delivered: boolean;
  attemptCount: number;
}> => {
  const now = deps.now ?? new Date();
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.sentAt) {
    return {
      sent: 0,
      invalidatedTokens: 0,
      delivered: true,
      attemptCount: notification?.attemptCount ?? 0,
    };
  }

  // Optimistic claim (compare-and-swap on attemptCount): if two overlapping
  // worker ticks — or a worker tick and an inline sendTransactionalPush — race
  // the same pending row, exactly one claim wins (the DB serialises the
  // updateMany on the row); the loser bails without sending. This is what
  // prevents duplicate Expo pushes. attemptCount is incremented HERE (once per
  // real attempt), so the failure branch below no longer increments it.
  const claim = await prisma.notification.updateMany({
    where: { id: notificationId, sentAt: null, attemptCount: notification.attemptCount },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count === 0) {
    return {
      sent: 0,
      invalidatedTokens: 0,
      delivered: true,
      attemptCount: notification.attemptCount,
    };
  }
  const attemptCount = notification.attemptCount + 1;

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: notification.userId },
    select: { expoPushToken: true },
  });
  if (tokens.length === 0) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: now },
    });
    return { sent: 0, invalidatedTokens: 0, delivered: true, attemptCount };
  }

  const pushData = buildPushDataFromRow(notification);
  const result = await deps.sender.send(
    tokens.map((t) => {
      const message: PushMessage = {
        to: t.expoPushToken,
        title: notification.title,
        body: notification.body,
        data: pushData,
      };
      return message;
    }),
  );

  let sent = 0;
  const invalid: string[] = [];
  let hasError = false;
  for (const [token, outcome] of result.outcomesByToken) {
    if (outcome.kind === 'ok') sent += 1;
    else if (outcome.kind === 'invalid-token') invalid.push(token);
    else hasError = true;
  }

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { userId: notification.userId, expoPushToken: { in: invalid } },
    });
  }

  if (sent > 0 || !hasError) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: now },
    });
    return { sent, invalidatedTokens: invalid.length, delivered: true, attemptCount };
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: { failureCode: 'send_error' },
  });
  return { sent, invalidatedTokens: invalid.length, delivered: false, attemptCount };
};

export const sendTransactionalPush = async (
  input: SendTransactionalPushInput,
  deps: { sender: PushSender },
): Promise<SendTransactionalPushResult> => {
  const enq = await enqueueNotification(input);
  if (enq.deduped) return { deduped: true, sent: 0, invalidatedTokens: 0 };
  const d = await deliverNotification(enq.id, deps);
  return { deduped: false, sent: d.sent, invalidatedTokens: d.invalidatedTokens };
};
