import { timingSafeEqual } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import type { AbacateWebhookEvent } from '../services/abacatepay/index.js';
import { releaseAllReservationsForOrders } from '../services/orders/expire.js';
import { revokeTicketsForRefundedOrder } from '../services/orders/revoke.js';
import { settlePaidOrder } from '../services/orders/settle.js';
import { sendTransactionalPush } from '../services/push/transactional.js';
import { EventPickupAssignmentUnavailableError } from '../services/store/event-pickup.js';
import {
  OrderNotPendingError,
  TicketAlreadyExistsForEventError,
  TicketRevokedForExtrasOnlyError,
} from '../services/tickets/issue.js';

const ACCEPTED_EVENTS = new Set([
  'transparent.completed',
  'transparent.refunded',
  'transparent.disputed',
  'transparent.lost',
]);

const markProcessed = async (eventId: string, payload: unknown): Promise<boolean> => {
  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'abacatepay',
        eventId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return false;
    }
    throw err;
  }
};

// Current AbacatePay v2 webhooks for `transparent.completed` nest the charge
// payload under `data.transparent` (alongside `customer` / `payerInformation`).
// Older shapes (`data.id`, `data.billing.id`, `data.billingId`) are kept as
// fallbacks for replay/back-compat.
// https://docs.abacatepay.com/pages/webhooks/events/transparent
const getTransparent = (data: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (typeof data.transparent === 'object' && data.transparent !== null) {
    return data.transparent as Record<string, unknown>;
  }
  return undefined;
};

const extractBillingId = (data: Record<string, unknown>): string | undefined => {
  const transparent = getTransparent(data);
  if (transparent && typeof transparent.id === 'string') return transparent.id;
  // Legacy flat shape used by older deliveries / tests
  if (typeof data.id === 'string') return data.id;
  if (typeof data.billing === 'object' && data.billing !== null) {
    const billing = data.billing as Record<string, unknown>;
    if (typeof billing.id === 'string') return billing.id;
  }
  if (typeof data.billingId === 'string') return data.billingId;
  return undefined;
};

const extractOrderIdFromMetadata = (data: Record<string, unknown>): string | undefined => {
  const transparent = getTransparent(data);
  if (transparent && typeof transparent.metadata === 'object' && transparent.metadata !== null) {
    const metadata = transparent.metadata as Record<string, unknown>;
    if (typeof metadata.orderId === 'string') return metadata.orderId;
  }
  if (typeof data.metadata === 'object' && data.metadata !== null) {
    const metadata = data.metadata as Record<string, unknown>;
    if (typeof metadata.orderId === 'string') return metadata.orderId;
  }
  return undefined;
};

const extractCartIdFromMetadata = (data: Record<string, unknown>): string | undefined => {
  const transparent = getTransparent(data);
  if (transparent && typeof transparent.metadata === 'object' && transparent.metadata !== null) {
    const metadata = transparent.metadata as Record<string, unknown>;
    if (typeof metadata.cartId === 'string') return metadata.cartId;
  }
  if (typeof data.metadata === 'object' && data.metadata !== null) {
    const metadata = data.metadata as Record<string, unknown>;
    if (typeof metadata.cartId === 'string') return metadata.cartId;
  }
  return undefined;
};

const getMetadataString = (data: Record<string, unknown>, key: string): string | undefined => {
  const transparent = getTransparent(data);
  if (transparent && typeof transparent.metadata === 'object' && transparent.metadata !== null) {
    const metadata = transparent.metadata as Record<string, unknown>;
    const value = metadata[key];
    if (typeof value === 'string') return value;
  }
  if (typeof data.metadata === 'object' && data.metadata !== null) {
    const metadata = data.metadata as Record<string, unknown>;
    const value = metadata[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
};

// metadata.orderIds is written by cart.ts as JSON.stringify(string[])
const extractOrderIdsFromMetadata = (data: Record<string, unknown>): string[] | undefined => {
  const raw = getMetadataString(data, 'orderIds');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const extractEventTimestamp = (data: Record<string, unknown>): Date | undefined => {
  const transparent = getTransparent(data);
  const source = transparent ?? data;
  const candidate =
    typeof source.updatedAt === 'string'
      ? source.updatedAt
      : typeof source.createdAt === 'string'
        ? source.createdAt
        : undefined;
  if (!candidate) return undefined;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

// M5: reject events whose payload timestamp is older than this window. Stops
// stale-replay attacks where a captured signed payload is delivered weeks later.
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const flagManualRefund = (context: {
  orderId?: string | null;
  cartId?: string | null;
  orderIds?: string[] | null;
  providerRef: string;
  userId: string;
  eventId: string | null;
  reason: string;
}) => {
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'pix-manual-refund-needed');
    scope.setTag('provider', 'abacatepay');
    scope.setTag('reason', context.reason);
    scope.setExtras({
      orderId: context.orderId ?? null,
      cartId: context.cartId ?? null,
      orderIds: context.orderIds ?? null,
      providerRef: context.providerRef,
      userId: context.userId,
      eventId: context.eventId,
    });
    Sentry.captureMessage(`abacatepay: manual refund needed (${context.reason})`, 'error');
  });
};

const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const cartSettlementPriority = (kind: 'ticket' | 'extras_only' | 'product' | 'mixed') => {
  if (kind === 'ticket') return 0;
  if (kind === 'extras_only') return 1;
  return 2;
};

export const abacatepayWebhookRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/abacatepay/webhook', { bodyLimit: 32_768 }, async (request, reply) => {
    if (!app.abacatepay) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'provider not configured' });
    }

    const webhookSecret = app.env.ABACATEPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'provider not configured' });
    }

    // C2/M1: URL-secret check first — proves this payload was destined for our merchant
    const querySecret = (request.query as Record<string, unknown>).webhookSecret;
    if (typeof querySecret !== 'string' || !constantTimeEquals(querySecret, webhookSecret)) {
      Sentry.addBreadcrumb({
        category: 'webhook',
        message: 'abacatepay webhook: webhookSecret mismatch',
        level: 'warning',
      });
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid secret' });
    }

    // C1: Signature check — proves payload was signed by AbacatePay (public key HMAC)
    const signature = request.headers['x-webhook-signature'];
    if (typeof signature !== 'string' || signature.length === 0) {
      Sentry.captureMessage('abacatepay webhook: missing signature header', {
        level: 'warning',
        tags: { kind: 'payment-webhook-signature', provider: 'abacatepay' },
      });
      return reply.status(401).send({ error: 'Unauthorized', message: 'missing signature' });
    }

    const raw = request.body as Buffer;
    try {
      app.abacatepay.verifyWebhookSignature(raw, signature);
    } catch (sigErr) {
      Sentry.withScope((scope) => {
        scope.setTag('kind', 'payment-webhook-signature');
        scope.setTag('provider', 'abacatepay');
        scope.setLevel('warning');
        Sentry.captureException(sigErr);
      });
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid signature' });
    }

    let event: AbacateWebhookEvent;
    try {
      event = JSON.parse(raw.toString()) as AbacateWebhookEvent;
    } catch {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid JSON' });
    }

    if (!event.id || !event.event) {
      return reply.status(400).send({ error: 'BadRequest', message: 'missing id or event field' });
    }

    // M-9: Fail closed — reject sandbox/devMode events in production unless an
    // explicit override is enabled for controlled internal testing.
    if (
      event.devMode &&
      app.env.NODE_ENV === 'production' &&
      !app.env.ABACATEPAY_DEV_WEBHOOK_ENABLED
    ) {
      Sentry.captureMessage('abacatepay webhook: devMode event received in production', {
        level: 'error',
        tags: { kind: 'webhook-devmode-in-prod', provider: 'abacatepay' },
        extra: { eventId: event.id, eventType: event.event },
      });
      request.log.warn(
        { eventId: event.id, eventType: event.event },
        'abacatepay webhook: rejected devMode event in production',
      );
      return reply
        .status(400)
        .send({ error: 'BadRequest', message: 'devMode events rejected in production' });
    }

    // L6: Reject unknown event types
    if (!ACCEPTED_EVENTS.has(event.event)) {
      request.log.info(
        { eventId: event.id, eventType: event.event },
        'abacatepay webhook: unknown event type, ignoring',
      );
      await markProcessed(event.id, event);
      return reply.status(200).send({ ok: true });
    }

    // M5: Replay window — reject events with payload timestamps older than 24h
    const eventTimestamp = extractEventTimestamp(event.data);
    if (eventTimestamp && Date.now() - eventTimestamp.getTime() > REPLAY_WINDOW_MS) {
      Sentry.captureMessage('abacatepay webhook: stale event rejected', {
        level: 'warning',
        tags: { kind: 'webhook-stale-replay', provider: 'abacatepay' },
        extra: { eventId: event.id, eventTimestamp: eventTimestamp.toISOString() },
      });
      request.log.warn(
        { eventId: event.id, eventTimestamp: eventTimestamp.toISOString() },
        'abacatepay webhook: stale event rejected',
      );
      await markProcessed(event.id, event);
      return reply.status(200).send({ ok: true });
    }

    // C3: Pix payment success — documented event name is transparent.completed
    if (event.event === 'transparent.completed') {
      const billingId = extractBillingId(event.data);
      if (!billingId) {
        Sentry.captureMessage('abacatepay webhook: transparent.completed missing billingId', {
          level: 'warning',
          tags: { kind: 'webhook-payload-invalid', provider: 'abacatepay' },
          extra: { eventId: event.id },
        });
        await markProcessed(event.id, event);
        return reply.status(200).send({ ok: true });
      }

      // H-3: Re-fetch provider state before trusting webhook payload.
      // On mismatch do NOT mark processed — return 409 so AbacatePay retries.
      // A transiently stale status will resolve on the next delivery.
      try {
        const upstream = await app.abacatepay.getPixBilling(billingId);
        if (upstream.status !== 'PAID') {
          request.log.warn(
            { billingId, upstreamStatus: upstream.status, eventId: event.id },
            'abacatepay webhook: provider re-fetch shows non-PAID status, deferring',
          );
          Sentry.captureMessage('abacatepay webhook: settlement deferred by provider re-fetch', {
            level: 'warning',
            tags: { kind: 'webhook-trust-mismatch', provider: 'abacatepay' },
            extra: { billingId, upstreamStatus: upstream.status },
          });
          return reply.status(409).send({ ok: false, reason: 'upstream-not-paid' });
        }
      } catch (fetchErr) {
        request.log.warn(
          { err: fetchErr, billingId },
          'abacatepay webhook: provider re-fetch failed, proceeding with caution',
        );
      }

      // Cart-level settlement: one billing → N orders flipped atomically
      const metadataCartId = extractCartIdFromMetadata(event.data);
      if (metadataCartId) {
        const cartOrders = await prisma.order.findMany({
          where: { cartId: metadataCartId, provider: 'abacatepay', status: 'pending' },
          select: { id: true, userId: true, eventId: true, amountCents: true, kind: true },
          orderBy: { createdAt: 'asc' },
        });

        if (cartOrders.length === 0) {
          const alreadyPaid = await prisma.order.findFirst({
            where: { cartId: metadataCartId, provider: 'abacatepay', status: 'paid' },
            select: { id: true },
          });
          if (alreadyPaid) {
            await markProcessed(event.id, event);
            return reply.status(200).send({ ok: true, deduped: true });
          }
          // JDMA-306: orphan billing — createPixBilling() succeeded but the
          // local pending orders are gone (rollbackCartCheckout on response
          // failure, manual deletion, etc.). The payer can still pay, leaving
          // no ticket and no manual-refund signal. Flag finance via Sentry
          // with the cart/order/user context AbacatePay echoed back to us.
          const firstTime = await markProcessed(event.id, event);
          if (firstTime) {
            const metadataUserId = getMetadataString(event.data, 'userId');
            const metadataOrderIds = extractOrderIdsFromMetadata(event.data);
            if (metadataUserId) {
              flagManualRefund({
                cartId: metadataCartId,
                orderIds: metadataOrderIds ?? null,
                providerRef: billingId,
                userId: metadataUserId,
                eventId: null,
                reason: 'cart-orphan-billing',
              });
            }
            request.log.warn(
              {
                cartId: metadataCartId,
                billingId,
                userId: metadataUserId ?? null,
                orderIds: metadataOrderIds ?? null,
                webhookEventId: event.id,
              },
              'abacatepay webhook: cart orphan billing settled, manual refund flagged',
            );
          }
          return reply.status(200).send({ ok: true, ignored: true });
        }

        cartOrders.sort((a, b) => cartSettlementPriority(a.kind) - cartSettlementPriority(b.kind));

        // JDMA-306: partial-mismatch reconciliation. metadata.orderIds records
        // every order the checkout intended to bill. If we found fewer pending
        // rows than metadata advertised, some were rolled back/deleted between
        // billing creation and webhook arrival; finance must sweep the missing
        // billed rows. We still settle the surviving rows below.
        const metadataOrderIds = extractOrderIdsFromMetadata(event.data);
        const metadataUserId = getMetadataString(event.data, 'userId');
        let missingOrderIds: string[] = [];
        if (metadataOrderIds && metadataOrderIds.length !== cartOrders.length) {
          const fetchedIds = new Set(cartOrders.map((o) => o.id));
          const unaccountedIds = metadataOrderIds.filter((id) => !fetchedIds.has(id));
          if (unaccountedIds.length > 0) {
            const existing = await prisma.order.findMany({
              where: { id: { in: unaccountedIds } },
              select: { id: true },
            });
            const existingIds = new Set(existing.map((o) => o.id));
            missingOrderIds = unaccountedIds.filter((id) => !existingIds.has(id));
          }
        }

        let issuedAnyTicket = false;
        for (const order of cartOrders) {
          try {
            const settled = await settlePaidOrder(order.id, billingId, app.env, {
              cartId: metadataCartId,
            });
            if (
              settled.kind === 'ticket' ||
              settled.kind === 'extras_only' ||
              (settled.kind === 'mixed' && (settled.issued?.length ?? 0) > 0)
            ) {
              issuedAnyTicket = true;
            }
          } catch (err) {
            if (err instanceof TicketAlreadyExistsForEventError) {
              flagManualRefund({
                orderId: order.id,
                providerRef: billingId,
                userId: order.userId,
                eventId: order.eventId,
                reason: 'duplicate-ticket',
              });
              continue;
            }
            if (err instanceof TicketRevokedForExtrasOnlyError) {
              flagManualRefund({
                orderId: order.id,
                providerRef: billingId,
                userId: order.userId,
                eventId: order.eventId,
                reason: 'ticket-revoked',
              });
              continue;
            }
            if (err instanceof OrderNotPendingError) {
              continue;
            }
            if (err instanceof EventPickupAssignmentUnavailableError) {
              flagManualRefund({
                orderId: order.id,
                providerRef: billingId,
                userId: order.userId,
                eventId: order.eventId,
                reason: 'pickup-ticket-unavailable',
              });
              continue;
            }
            throw err;
          }
        }

        await prisma.cart.update({
          where: { id: metadataCartId },
          data: { status: 'converted' },
        });

        const firstTime = await markProcessed(event.id, event);
        request.log.info(
          { cartId: metadataCartId, billingId, firstTime },
          'abacatepay webhook: cart settled',
        );

        if (firstTime && missingOrderIds.length > 0 && metadataUserId) {
          flagManualRefund({
            cartId: metadataCartId,
            orderIds: missingOrderIds,
            providerRef: billingId,
            userId: metadataUserId,
            eventId: null,
            reason: 'cart-partial-orphan-billing',
          });
          request.log.warn(
            {
              cartId: metadataCartId,
              billingId,
              userId: metadataUserId,
              missingOrderIds,
              webhookEventId: event.id,
            },
            'abacatepay webhook: cart partial orphan billing settled, manual refund flagged',
          );
        }

        try {
          const userId = issuedAnyTicket ? cartOrders[0]?.userId : undefined;
          if (userId) {
            await sendTransactionalPush(
              {
                userId,
                kind: 'ticket.confirmed',
                dedupeKey: `cart_${metadataCartId}`,
                title: 'Ingressos confirmados',
                body: 'Seus ingressos estão prontos.',
                data: { cartId: metadataCartId },
              },
              { sender: app.push },
            );
          }
        } catch (pushErr) {
          request.log.warn(
            { err: pushErr, cartId: metadataCartId },
            'abacatepay cart webhook: push failed',
          );
        }

        return reply.status(200).send({ ok: true, deduped: !firstTime });
      }

      // Primary lookup: orderId from metadata (passed during /transparents/create)
      // Fallback: lookup by providerRef (charge ID) for backwards compat
      const metadataOrderId = extractOrderIdFromMetadata(event.data);
      const order = metadataOrderId
        ? await prisma.order.findFirst({
            where: { id: metadataOrderId, provider: 'abacatepay' },
            select: { id: true, userId: true, eventId: true },
          })
        : await prisma.order.findFirst({
            where: { provider: 'abacatepay', providerRef: billingId },
            select: { id: true, userId: true, eventId: true },
          });

      if (!order) {
        Sentry.addBreadcrumb({
          category: 'webhook',
          message: `abacatepay transparent.completed: no order for billingId=${billingId}`,
          level: 'warning',
        });
        request.log.warn(
          { eventId: event.id, billingId },
          'abacatepay webhook: transparent.completed no matching order',
        );
        await markProcessed(event.id, event);
        return reply.status(200).send({ ok: true });
      }

      try {
        const settled = await settlePaidOrder(order.id, billingId, app.env);
        const firstTime = await markProcessed(event.id, event);
        request.log.info(
          { orderId: order.id, billingId, firstTime },
          'abacatepay webhook: order settled',
        );
        if (settled.kind === 'ticket' || settled.kind === 'extras_only') {
          try {
            await sendTransactionalPush(
              {
                userId: settled.issued.userId,
                kind: 'ticket.confirmed',
                dedupeKey: order.id,
                title: 'Pagamento confirmado',
                body: `Seu ingresso para ${settled.issued.eventTitle} está pronto.`,
                data: {
                  orderId: order.id,
                  ticketId: settled.issued.ticketId,
                  eventId: settled.issued.eventId,
                },
              },
              { sender: app.push },
            );
          } catch (pushErr) {
            request.log.warn(
              { err: pushErr, orderId: order.id },
              'abacatepay webhook: ticket-confirmed push failed',
            );
            Sentry.withScope((scope) => {
              scope.setTag('kind', 'push-send-failure');
              scope.setTag('push_kind', 'ticket.confirmed');
              scope.setLevel('warning');
              scope.setExtras({ orderId: order.id });
              Sentry.captureException(pushErr);
            });
          }
        }
        // M2: Don't leak internal state in response
        return reply.status(200).send({ ok: true });
      } catch (err) {
        if (err instanceof TicketAlreadyExistsForEventError) {
          flagManualRefund({
            orderId: order.id,
            providerRef: billingId,
            userId: order.userId,
            eventId: order.eventId,
            reason: 'duplicate-ticket',
          });
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId: order.id, billingId },
            'abacatepay webhook: duplicate ticket, manual refund flagged',
          );
          return reply.status(200).send({ ok: true });
        }
        if (err instanceof TicketRevokedForExtrasOnlyError) {
          flagManualRefund({
            orderId: order.id,
            providerRef: billingId,
            userId: order.userId,
            eventId: order.eventId,
            reason: 'ticket-revoked',
          });
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId: order.id, billingId },
            'abacatepay webhook: extras-only ticket revoked, manual refund flagged',
          );
          return reply.status(200).send({ ok: true });
        }
        if (err instanceof EventPickupAssignmentUnavailableError) {
          flagManualRefund({
            orderId: order.id,
            providerRef: billingId,
            userId: order.userId,
            eventId: order.eventId,
            reason: 'pickup-ticket-unavailable',
          });
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId: order.id, billingId, pickupEventId: err.eventId },
            'abacatepay webhook: event pickup assignment unavailable, manual refund flagged',
          );
          return reply.status(200).send({ ok: true });
        }
        if (err instanceof OrderNotPendingError) {
          const staleOrder = await prisma.order.findUnique({
            where: { id: order.id },
            select: { status: true },
          });
          if (staleOrder?.status === 'paid') {
            await markProcessed(event.id, event);
            return reply.status(200).send({ ok: true });
          }
          if (staleOrder?.status === 'expired') {
            flagManualRefund({
              orderId: order.id,
              providerRef: billingId,
              userId: order.userId,
              eventId: order.eventId,
              reason: 'order-expired',
            });
            await markProcessed(event.id, event);
            request.log.warn(
              { orderId: order.id, billingId },
              'abacatepay webhook: order expired, manual refund flagged',
            );
            return reply.status(200).send({ ok: true });
          }
          // H2: Handle cancelled + any other non-pending status — return 200 to stop retries
          flagManualRefund({
            orderId: order.id,
            providerRef: billingId,
            userId: order.userId,
            eventId: order.eventId,
            reason: `order-${staleOrder?.status ?? 'unknown'}`,
          });
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId: order.id, billingId, status: staleOrder?.status },
            'abacatepay webhook: order not pending, manual refund flagged',
          );
          return reply.status(200).send({ ok: true });
        }
        throw err;
      }
    }

    // Failure events: release inventory immediately rather than waiting for TTL sweep.
    // `lost` mirrors Stripe `payment_intent.payment_failed` / `checkout.session.expired`
    // (pending Pix never paid). `refunded` and `disputed` may arrive on a previously
    // paid order; tickets for paid orders are revoked after the status transition.
    if (
      event.event === 'transparent.lost' ||
      event.event === 'transparent.refunded' ||
      event.event === 'transparent.disputed'
    ) {
      const targetStatus: 'failed' | 'refunded' =
        event.event === 'transparent.lost' ? 'failed' : 'refunded';

      const metadataCartId = extractCartIdFromMetadata(event.data);
      const metadataOrderId = extractOrderIdFromMetadata(event.data);
      const billingId = extractBillingId(event.data);

      let pendingOrderIds: string[] = [];
      let paidOrderIds: string[] = [];
      if (metadataCartId) {
        const cartOrders = await prisma.order.findMany({
          where: { cartId: metadataCartId, provider: 'abacatepay', status: 'pending' },
          select: { id: true },
        });
        pendingOrderIds = cartOrders.map((o) => o.id);
        if (event.event === 'transparent.refunded') {
          const paidOrders = await prisma.order.findMany({
            where: { cartId: metadataCartId, provider: 'abacatepay', status: 'paid' },
            select: { id: true },
          });
          paidOrderIds = paidOrders.map((o) => o.id);
        }
      } else if (metadataOrderId) {
        const order = await prisma.order.findFirst({
          where: { id: metadataOrderId, provider: 'abacatepay', status: 'pending' },
          select: { id: true },
        });
        if (order) pendingOrderIds = [order.id];
        if (event.event === 'transparent.refunded') {
          const paidOrder = await prisma.order.findFirst({
            where: { id: metadataOrderId, provider: 'abacatepay', status: 'paid' },
            select: { id: true },
          });
          if (paidOrder) paidOrderIds = [paidOrder.id];
        }
      } else if (billingId) {
        const order = await prisma.order.findFirst({
          where: { provider: 'abacatepay', providerRef: billingId, status: 'pending' },
          select: { id: true },
        });
        if (order) pendingOrderIds = [order.id];
        if (event.event === 'transparent.refunded') {
          const paidOrder = await prisma.order.findFirst({
            where: { provider: 'abacatepay', providerRef: billingId, status: 'paid' },
            select: { id: true },
          });
          if (paidOrder) paidOrderIds = [paidOrder.id];
        }
      }

      let releasedCount = 0;
      if (pendingOrderIds.length > 0 || paidOrderIds.length > 0) {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: { in: pendingOrderIds }, status: 'pending' },
            data:
              targetStatus === 'failed'
                ? { status: 'failed', failedAt: new Date() }
                : { status: 'refunded', refundedAt: new Date() },
          });
          releasedCount = updated.count;
          if (updated.count > 0) {
            await releaseAllReservationsForOrders(tx, pendingOrderIds);
          }
          if (event.event === 'transparent.lost' && metadataCartId) {
            await tx.cart.update({
              where: { id: metadataCartId },
              data: { status: 'open' },
            });
          }
          if (event.event === 'transparent.refunded' && paidOrderIds.length > 0) {
            await tx.order.updateMany({
              where: { id: { in: paidOrderIds }, status: 'paid' },
              data: { status: 'refunded', refundedAt: new Date() },
            });
          }
        });
      }

      if (paidOrderIds.length > 0) {
        for (const oid of paidOrderIds) {
          await revokeTicketsForRefundedOrder(oid);
        }
      }

      const firstTime = await markProcessed(event.id, event);
      request.log.info(
        {
          eventId: event.id,
          eventType: event.event,
          released: releasedCount,
          revokedPaid: paidOrderIds.length,
          orderIds: pendingOrderIds,
          paidOrderIds,
          firstTime,
        },
        'abacatepay webhook: failure event processed',
      );
      return reply.status(200).send({ ok: true, deduped: !firstTime });
    }

    // Non-payment events: log and mark processed
    const firstTime = await markProcessed(event.id, event);
    if (!firstTime) {
      request.log.info({ eventId: event.id }, 'abacatepay webhook: dedup skip');
      return reply.status(200).send({ ok: true });
    }

    request.log.info(
      { eventId: event.id, eventType: event.event, devMode: event.devMode },
      'abacatepay webhook: unhandled event type',
    );

    return reply.status(200).send({ ok: true });
  });
};
