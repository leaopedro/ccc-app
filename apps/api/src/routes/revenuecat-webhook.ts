import { timingSafeEqual } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import {
  applyMembershipEvent,
  enqueuePremiumTicketBackfillIfActivated,
} from '../services/billing/apply-membership-event.js';
import {
  normalizeRevenueCatEvent,
  type RCNonBrSentinel,
} from '../services/billing/normalize-revenuecat.js';

// Constant-time string comparison — prevents timing-oracle auth bypass.
// Mirrors abacatepay-webhook.ts::constantTimeEquals.
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const isNonBrSentinel = (v: unknown): v is RCNonBrSentinel =>
  typeof v === 'object' && v !== null && (v as Record<string, unknown>).kind === '__non_br__';

export const revenuecatWebhookRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  app.post('/webhooks/revenuecat', { bodyLimit: 32_768 }, async (request, reply) => {
    // Canon §F8.11 — feature flag gate. 200 + skip so RC stops retrying.
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      request.log.info({}, 'revenuecat webhook: GROWTH_PREMIUM_BILLING_ENABLED=false, skipping');
      return reply.status(200).send({ ok: true, skipped: true });
    }

    // Auth: constant-time compare of Authorization header against the
    // operator-configured secret. RC sends the raw secret as the Authorization
    // header value. 401 on mismatch (RC won't retry 401 → alerts the operator).
    const authHeader = request.headers.authorization ?? '';
    const expectedAuth = app.env.REVENUECAT_WEBHOOK_AUTH_HEADER;

    if (
      typeof expectedAuth !== 'string' ||
      expectedAuth.length === 0 ||
      !constantTimeEquals(authHeader, expectedAuth)
    ) {
      Sentry.captureMessage('revenuecat webhook: auth header mismatch', {
        level: 'warning',
        tags: { kind: 'subscription-webhook-auth', provider: 'apple_revenuecat' },
      });
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid auth header' });
    }

    // Parse body — RC sends JSON; no raw buffer needed.
    let body: unknown;
    try {
      body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    } catch {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid JSON' });
    }

    const eventObj = (body as Record<string, unknown> | null)?.event as
      | Record<string, unknown>
      | undefined;
    const providerEventId = typeof eventObj?.id === 'string' ? eventObj.id : null;
    const eventType = typeof eventObj?.type === 'string' ? eventObj.type : 'UNKNOWN';
    const garageId = typeof eventObj?.app_user_id === 'string' ? eventObj.app_user_id : null;

    if (!providerEventId) {
      request.log.warn({}, 'revenuecat webhook: missing event.id, ignoring');
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // Normalize first so we can short-circuit the non-BR sentinel without
    // consuming the idempotency slot (canon §F8.9 + plan deviation #1: RC may
    // retry country_code-bearing events; we want to re-evaluate every delivery
    // until BR scope expands).
    const normalized = normalizeRevenueCatEvent(body);

    if (isNonBrSentinel(normalized)) {
      request.log.info(
        { providerEventId: normalized.providerEventId, country_code: normalized.country_code },
        'premium_rc.non_br_storefront',
      );
      Sentry.addBreadcrumb({
        category: 'billing',
        message: 'RC non-BR storefront event received',
        level: 'info',
        data: {
          providerEventId: normalized.providerEventId,
          country_code: normalized.country_code,
        },
      });
      return reply.status(200).send({ ok: true, non_br: true });
    }

    // Canon §F8.15 layer (a) — insert SubscriptionWebhookEvent. P2002 short-
    // circuits 200 OK if the prior row was processed (replay). If the prior
    // row is still unprocessed (apply tx crashed or concurrent in-flight),
    // return 503 so RC retries — idempotency of downstream apply is protected
    // by canon §F8.15 second layer + F8.03 SAVEPOINT.
    try {
      await prisma.subscriptionWebhookEvent.create({
        data: {
          provider: 'apple_revenuecat',
          providerEventId,
          type: eventType,
          payload: body as Prisma.InputJsonValue,
          processedAt: null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        const existing = await prisma.subscriptionWebhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: 'apple_revenuecat',
              providerEventId,
            },
          },
          select: { processedAt: true },
        });
        if (existing?.processedAt) {
          request.log.info(
            { providerEventId },
            'revenuecat webhook: replay deduped at idempotency layer',
          );
          return reply.status(200).send({ ok: true, deduped: true });
        }
        request.log.warn(
          { providerEventId },
          'revenuecat webhook: dedup hit on unprocessed event, asking RC to retry',
        );
        return reply.status(503).send({
          error: 'Processing',
          message: 'concurrent or stale unprocessed event, retry',
        });
      }
      throw err;
    }

    // Ignorable event type — log + mark processed; no state change.
    if (normalized === null) {
      request.log.info(
        { providerEventId, eventType },
        'revenuecat webhook: ignorable event type, acked without state change',
      );
      await prisma.subscriptionWebhookEvent.update({
        where: { provider_providerEventId: { provider: 'apple_revenuecat', providerEventId } },
        data: { processedAt: new Date() },
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // State-changing event. The applyMembershipEvent contract (canon §F8.5)
    // requires the caller to (1) open a transaction, (2) hold a SELECT FOR
    // UPDATE on the target Garage row, then (3) call the service. This
    // serializes concurrent webhooks for the same garage.
    if (!garageId) {
      request.log.warn(
        { providerEventId, eventType },
        'revenuecat webhook: state-changing event missing app_user_id',
      );
      await prisma.subscriptionWebhookEvent.update({
        where: { provider_providerEventId: { provider: 'apple_revenuecat', providerEventId } },
        data: { processedAt: new Date() },
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
        await applyMembershipEvent(tx, normalized);
      });

      // Canon §F8.4 post-commit hook: enqueue ticket backfill on activation.
      // No-op for renewal/cancel/expiry/past_due/uncancel/tier_changed.
      // MUST run BEFORE processedAt is set: if enqueue fails after processedAt
      // commits, RC retry would hit the dedup catch (processedAt non-null),
      // return 200, and the backfill would be permanently lost.
      await enqueuePremiumTicketBackfillIfActivated(prisma, normalized);

      await prisma.subscriptionWebhookEvent.update({
        where: { provider_providerEventId: { provider: 'apple_revenuecat', providerEventId } },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag('kind', 'subscription-webhook-apply');
        scope.setTag('provider', 'apple_revenuecat');
        scope.setExtras({ providerEventId, eventType });
        Sentry.captureException(err);
      });
      throw err;
    }

    request.log.info({ providerEventId, eventType }, 'revenuecat webhook: event applied');

    return reply.status(200).send({ ok: true });
  });
};
