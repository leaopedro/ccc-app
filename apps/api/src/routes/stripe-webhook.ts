import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { revokeTicketsForRefundedOrder } from '../services/orders/revoke.js';
import { settlePaidOrder } from '../services/orders/settle.js';
import { sendTransactionalPush } from '../services/push/transactional.js';
import { EventPickupAssignmentUnavailableError } from '../services/store/event-pickup.js';
import {
  OrderNotPendingError,
  TicketAlreadyExistsForEventError,
  TicketRevokedForExtrasOnlyError,
} from '../services/tickets/issue.js';

// Record the event as seen AFTER dispatch succeeds. If we did it first, a
// dispatch failure would leave the event marked-seen forever and Stripe
// retries would short-circuit at the dedup branch, stranding the order in
// `pending`. issueTicketForPaidOrder is idempotent (already-paid path), and
// the failed-path handler uses count-guarded updateMany, so running dispatch
// on a redelivery is safe.
const markProcessed = async (eventId: string, payload: unknown): Promise<boolean> => {
  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'stripe',
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

const markRefundedAndReleaseReservation = async (orderId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'refunded', refundedAt: new Date() },
    });
    if (updated.count !== 1) return;

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.kind === 'ticket' && order.tierId) {
      await tx.ticketTier.updateMany({
        where: { id: order.tierId, quantitySold: { gte: order.quantity } },
        data: { quantitySold: { decrement: order.quantity } },
      });
    }

    if (order.kind === 'mixed') {
      const ticketItems = await tx.orderItem.findMany({
        where: { orderId, kind: 'ticket' },
        select: { tierId: true, quantity: true },
      });
      for (const { tierId, quantity } of ticketItems) {
        if (!tierId) continue;
        await tx.ticketTier.updateMany({
          where: { id: tierId, quantitySold: { gte: quantity } },
          data: { quantitySold: { decrement: quantity } },
        });
      }
    }

    const orderExtras = await tx.orderExtra.findMany({
      where: { orderId },
      select: { extraId: true, quantity: true },
    });
    for (const { extraId, quantity } of orderExtras) {
      await tx.ticketExtra.updateMany({
        where: { id: extraId, quantitySold: { gte: quantity } },
        data: { quantitySold: { decrement: quantity } },
      });
    }

    const productItems = await tx.orderItem.findMany({
      where: { orderId, kind: 'product' },
      select: { variantId: true, quantity: true },
    });
    for (const { variantId, quantity } of productItems) {
      if (!variantId) continue;
      await tx.variant.updateMany({
        where: { id: variantId, quantitySold: { gte: quantity } },
        data: { quantitySold: { decrement: quantity } },
      });
    }
  });
};

const cartSettlementPriority = (kind: 'ticket' | 'extras_only' | 'product' | 'mixed') => {
  if (kind === 'ticket') return 0;
  if (kind === 'extras_only') return 1;
  return 2;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  const handleCartPaymentSucceeded = async (
    cartId: string,
    piId: string,
    webhookEvent: { id: string; type: string; data: { object: Record<string, unknown> } },
    request: { log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } },
    reply: { status: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    const orders = await prisma.order.findMany({
      where: { cartId, status: 'pending' },
      select: { id: true, amountCents: true, kind: true },
      orderBy: { createdAt: 'asc' },
    });

    if (orders.length === 0) {
      const alreadyPaid = await prisma.order.findFirst({
        where: { cartId, status: 'paid' },
        select: { id: true },
      });
      if (alreadyPaid) {
        await markProcessed(webhookEvent.id, webhookEvent);
        return reply.status(200).send({ ok: true, deduped: true });
      }
      return reply.status(200).send({ ok: true, ignored: true });
    }

    orders.sort((a, b) => cartSettlementPriority(a.kind) - cartSettlementPriority(b.kind));

    let issuedAnyTicket = false;
    for (const order of orders) {
      try {
        const settled = await settlePaidOrder(order.id, piId, app.env, { cartId });
        if (
          settled.kind === 'ticket' ||
          settled.kind === 'extras_only' ||
          (settled.kind === 'mixed' && (settled.issued?.length ?? 0) > 0)
        ) {
          issuedAnyTicket = true;
        }
      } catch (err) {
        if (err instanceof TicketAlreadyExistsForEventError) {
          await app.stripe.refund(piId, 'duplicate-ticket', order.amountCents);
          await markRefundedAndReleaseReservation(order.id);
          request.log.warn(
            { orderId: order.id, piId },
            'cart webhook: duplicate ticket, partial refund',
          );
          continue;
        }
        if (err instanceof OrderNotPendingError) {
          continue;
        }
        if (err instanceof EventPickupAssignmentUnavailableError) {
          await app.stripe.refund(piId, 'pickup-ticket-unavailable', order.amountCents);
          await markRefundedAndReleaseReservation(order.id);
          request.log.warn(
            { orderId: order.id, piId, pickupEventId: err.eventId },
            'cart webhook: event pickup assignment unavailable, partial refund',
          );
          continue;
        }
        throw err;
      }
    }

    await prisma.cart.update({
      where: { id: cartId },
      data: { status: 'converted' },
    });

    const firstTime = await markProcessed(webhookEvent.id, webhookEvent);
    request.log.info({ cartId, piId, firstTime }, 'stripe webhook: cart checkout settled');

    try {
      const userId =
        issuedAnyTicket &&
        (
          await prisma.order.findFirst({
            where: { cartId },
            select: { userId: true },
          })
        )?.userId;
      if (userId) {
        await sendTransactionalPush(
          {
            userId,
            kind: 'ticket.confirmed',
            dedupeKey: `cart_${cartId}`,
            title: 'Ingressos confirmados',
            body: 'Seus ingressos estão prontos.',
            data: { cartId },
          },
          { sender: app.push },
        );
      }
    } catch (pushErr) {
      request.log.warn({ err: pushErr, cartId }, 'cart webhook: push failed');
    }

    return reply.status(200).send({ ok: true, deduped: !firstTime });
  };

  const handleCartFailure = async (
    cartId: string,
    webhookEvent: { id: string; type: string; data: { object: Record<string, unknown> } },
    request: { log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } },
    reply: { status: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    await prisma.$transaction(async (tx) => {
      const cartOrders = await tx.order.findMany({
        where: { cartId, status: 'pending' },
      });

      for (const order of cartOrders) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'failed', failedAt: new Date() },
        });

        if (order.kind === 'ticket' && order.tierId) {
          await tx.ticketTier.updateMany({
            where: { id: order.tierId, quantitySold: { gte: order.quantity } },
            data: { quantitySold: { decrement: order.quantity } },
          });
        }

        if (order.kind === 'mixed') {
          const ticketItems = await tx.orderItem.findMany({
            where: { orderId: order.id, kind: 'ticket' },
            select: { tierId: true, quantity: true },
          });
          for (const { tierId, quantity } of ticketItems) {
            if (!tierId) continue;
            await tx.ticketTier.updateMany({
              where: { id: tierId, quantitySold: { gte: quantity } },
              data: { quantitySold: { decrement: quantity } },
            });
          }
        }

        const orderExtras = await tx.orderExtra.findMany({
          where: { orderId: order.id },
          select: { extraId: true, quantity: true },
        });
        for (const { extraId, quantity } of orderExtras) {
          await tx.ticketExtra.updateMany({
            where: { id: extraId, quantitySold: { gte: quantity } },
            data: { quantitySold: { decrement: quantity } },
          });
        }

        const productItems = await tx.orderItem.findMany({
          where: { orderId: order.id, kind: 'product' },
          select: { variantId: true, quantity: true },
        });
        for (const { variantId, quantity } of productItems) {
          if (!variantId) continue;
          await tx.variant.updateMany({
            where: { id: variantId, quantitySold: { gte: quantity } },
            data: { quantitySold: { decrement: quantity } },
          });
        }
      }

      await tx.cart.update({
        where: { id: cartId },
        data: { status: 'open' },
      });
    });

    const firstTime = await markProcessed(webhookEvent.id, webhookEvent);
    request.log.info({ cartId, firstTime }, 'stripe webhook: cart checkout failed/expired');
    return reply.status(200).send({ ok: true, deduped: !firstTime });
  };

  app.post('/stripe/webhook', async (request, reply) => {
    const signatureHeader =
      request.headers['stripe-signature'] ?? request.headers['webhook-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (typeof signature !== 'string' || signature.length === 0) {
      Sentry.captureMessage('stripe webhook: missing signature header', {
        level: 'warning',
        tags: { kind: 'payment-webhook-signature', provider: 'stripe' },
      });
      return reply.status(400).send({ error: 'BadRequest', message: 'missing signature' });
    }
    const raw = request.body as Buffer;
    let event;
    try {
      event = await app.stripe.constructWebhookEvent(raw, signature);
    } catch (sigErr) {
      Sentry.withScope((scope) => {
        scope.setTag('kind', 'payment-webhook-signature');
        scope.setTag('provider', 'stripe');
        scope.setLevel('warning');
        Sentry.captureException(sigErr);
      });
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid signature' });
    }

    const intent = event.data.object as { id?: string; metadata?: Record<string, string> };
    const orderId = intent.metadata?.orderId;
    const cartId = intent.metadata?.cartId;

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as {
        payment_intent?: string;
        amount?: number;
        amount_refunded?: number;
      };
      const piId = charge.payment_intent;
      const amount = charge.amount ?? 0;
      const amountRefunded = charge.amount_refunded ?? 0;

      if (!piId) {
        return reply.status(200).send({ ok: true, ignored: true, reason: 'missing-pi' });
      }

      const order = await prisma.order.findFirst({
        where: { provider: 'stripe', providerRef: piId },
        select: { id: true, status: true },
      });

      if (!order) {
        request.log.warn(
          { paymentIntentId: piId, eventId: event.id },
          'stripe webhook: charge.refunded for unknown order',
        );
        return reply.status(200).send({ ok: true, ignored: true, reason: 'unknown-order' });
      }

      // Stripe partial refunds need separate handling (line-item attribution,
      // refundedCents partial accounting). Out of scope for JDMA-312; flag and
      // skip status flip so finance is not misled.
      if (amountRefunded < amount) {
        request.log.warn(
          { orderId: order.id, paymentIntentId: piId, amount, amountRefunded },
          'stripe webhook: charge.refunded partial refund ignored',
        );
        Sentry.captureMessage('stripe webhook: partial refund received', {
          level: 'warning',
          tags: { kind: 'payment-webhook-partial-refund', provider: 'stripe' },
          extra: { orderId: order.id, paymentIntentId: piId, amount, amountRefunded },
        });
        await markProcessed(event.id, event);
        return reply.status(200).send({ ok: true, ignored: true, reason: 'partial-refund' });
      }

      await prisma.order.updateMany({
        where: { id: order.id, status: 'paid' },
        data: { status: 'refunded' },
      });
      await revokeTicketsForRefundedOrder(order.id);

      const firstTime = await markProcessed(event.id, event);
      request.log.info(
        { orderId: order.id, paymentIntentId: piId, firstTime },
        'stripe webhook: charge.refunded settled',
      );
      return reply.status(200).send({ ok: true, refunded: true, deduped: !firstTime });
    }

    // Cart checkout settlement: multiple orders linked by cartId
    if (event.type === 'payment_intent.succeeded' && cartId && intent.id) {
      return handleCartPaymentSucceeded(cartId, intent.id, event, request, reply);
    }

    if (event.type === 'payment_intent.succeeded' && orderId && intent.id) {
      try {
        const settled = await settlePaidOrder(orderId, intent.id, app.env, intent.metadata);
        const firstTime = await markProcessed(event.id, event);
        request.log.info(
          { orderId, paymentIntentId: intent.id, firstTime },
          'stripe webhook: order settled',
        );
        if (settled.kind === 'ticket' || settled.kind === 'extras_only') {
          try {
            await sendTransactionalPush(
              {
                userId: settled.issued.userId,
                kind: 'ticket.confirmed',
                dedupeKey: orderId,
                title: 'Ingresso confirmado',
                body: `Seu ingresso para ${settled.issued.eventTitle} está pronto.`,
                data: {
                  orderId,
                  ticketId: settled.issued.ticketId,
                  eventId: settled.issued.eventId,
                },
              },
              { sender: app.push },
            );
          } catch (pushErr) {
            request.log.warn(
              { err: pushErr, orderId },
              'stripe webhook: ticket-confirmed push failed',
            );
            Sentry.withScope((scope) => {
              scope.setTag('kind', 'push-send-failure');
              scope.setTag('push_kind', 'ticket.confirmed');
              scope.setLevel('warning');
              scope.setExtras({ orderId });
              Sentry.captureException(pushErr);
            });
          }
        }
        return reply.status(200).send({ ok: true, deduped: !firstTime });
      } catch (err) {
        // Customer paid but we can't issue a ticket (usually because an
        // unrelated valid ticket exists: comp or premium_grant landed between
        // POST /orders and webhook delivery). Refund so Stripe stops retrying
        // and the customer isn't charged for nothing.
        if (err instanceof TicketAlreadyExistsForEventError) {
          await app.stripe.refund(intent.id, 'duplicate-ticket');
          await markRefundedAndReleaseReservation(orderId);
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId, paymentIntentId: intent.id },
            'stripe webhook: duplicate ticket, refunded',
          );
          return reply.status(200).send({ ok: true, refunded: true });
        }
        if (err instanceof TicketRevokedForExtrasOnlyError) {
          await app.stripe.refund(intent.id, 'ticket-revoked');
          await markRefundedAndReleaseReservation(orderId);
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId, paymentIntentId: intent.id },
            'stripe webhook: extras-only ticket revoked, refunded',
          );
          return reply.status(200).send({ ok: true, refunded: true, reason: 'ticket-revoked' });
        }
        if (err instanceof EventPickupAssignmentUnavailableError) {
          await app.stripe.refund(intent.id, 'pickup-ticket-unavailable');
          await markRefundedAndReleaseReservation(orderId);
          await markProcessed(event.id, event);
          request.log.warn(
            { orderId, paymentIntentId: intent.id, pickupEventId: err.eventId },
            'stripe webhook: event pickup assignment unavailable, refunded',
          );
          return reply
            .status(200)
            .send({ ok: true, refunded: true, reason: 'pickup-ticket-unavailable' });
        }
        // Order expired between POST /orders and webhook delivery.
        // Customer paid but capacity was already released — refund immediately.
        if (err instanceof OrderNotPendingError) {
          const staleOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          if (staleOrder?.status === 'expired') {
            await app.stripe.refund(intent.id, 'order-expired');
            await markProcessed(event.id, event);
            request.log.warn(
              { orderId, paymentIntentId: intent.id },
              'stripe webhook: order expired at payment, refunded',
            );
            return reply.status(200).send({ ok: true, refunded: true, reason: 'expired' });
          }
        }
        throw err;
      }
    }

    const session = event.data.object as {
      id?: string;
      metadata?: Record<string, string>;
      payment_intent?: string;
      payment_status?: string;
    };

    if (event.type === 'checkout.session.completed') {
      let piId = typeof session.payment_intent === 'string' ? session.payment_intent : undefined;
      if (!piId && session.id) {
        piId = (await app.stripe.getCheckoutSessionPaymentIntentId(session.id)) ?? undefined;
      }
      if (session.payment_status !== 'paid' || !piId) {
        return reply.status(200).send({ ok: true, ignored: true });
      }

      let sessionCartId = session.metadata?.cartId;
      if (!sessionCartId) {
        const cartOrder = await prisma.order.findFirst({
          where: { provider: 'stripe', providerRef: piId, cartId: { not: null } },
          select: { cartId: true },
        });
        if (cartOrder?.cartId) sessionCartId = cartOrder.cartId;
      }
      if (sessionCartId) {
        return handleCartPaymentSucceeded(sessionCartId, piId, event, request, reply);
      }

      let sessionOrderId = session.metadata?.orderId;
      if (!sessionOrderId) {
        const order = await prisma.order.findFirst({
          where: { provider: 'stripe', providerRef: piId },
          select: { id: true },
        });
        sessionOrderId = order?.id;
      }
      if (!sessionOrderId) {
        request.log.warn(
          { sessionId: session.id, piId },
          'stripe webhook: checkout.session.completed missing orderId and no matching order by providerRef',
        );
        return reply.status(200).send({ ok: true, ignored: true });
      }
      try {
        const settled = await settlePaidOrder(sessionOrderId, piId, app.env, session.metadata);
        const firstTime = await markProcessed(event.id, event);
        request.log.info(
          { orderId: sessionOrderId, sessionId: session.id, firstTime },
          'stripe webhook: checkout.session.completed settled order',
        );
        if (settled.kind === 'ticket' || settled.kind === 'extras_only') {
          try {
            await sendTransactionalPush(
              {
                userId: settled.issued.userId,
                kind: 'ticket.confirmed',
                dedupeKey: sessionOrderId,
                title: 'Ingresso confirmado',
                body: `Seu ingresso para ${settled.issued.eventTitle} está pronto.`,
                data: {
                  orderId: sessionOrderId,
                  ticketId: settled.issued.ticketId,
                  eventId: settled.issued.eventId,
                },
              },
              { sender: app.push },
            );
          } catch (pushErr) {
            request.log.warn(
              { err: pushErr, orderId: sessionOrderId },
              'stripe webhook: ticket-confirmed push failed (checkout.session)',
            );
          }
        }
        return reply.status(200).send({ ok: true, deduped: !firstTime });
      } catch (err) {
        if (err instanceof TicketAlreadyExistsForEventError) {
          await app.stripe.refund(piId, 'duplicate-ticket');
          await markRefundedAndReleaseReservation(sessionOrderId);
          await markProcessed(event.id, event);
          return reply.status(200).send({ ok: true, refunded: true });
        }
        if (err instanceof TicketRevokedForExtrasOnlyError) {
          await app.stripe.refund(piId, 'ticket-revoked');
          await markRefundedAndReleaseReservation(sessionOrderId);
          await markProcessed(event.id, event);
          return reply.status(200).send({ ok: true, refunded: true, reason: 'ticket-revoked' });
        }
        if (err instanceof EventPickupAssignmentUnavailableError) {
          await app.stripe.refund(piId, 'pickup-ticket-unavailable');
          await markRefundedAndReleaseReservation(sessionOrderId);
          await markProcessed(event.id, event);
          return reply
            .status(200)
            .send({ ok: true, refunded: true, reason: 'pickup-ticket-unavailable' });
        }
        if (err instanceof OrderNotPendingError) {
          const staleOrder = await prisma.order.findUnique({
            where: { id: sessionOrderId },
            select: { status: true },
          });
          if (staleOrder?.status === 'expired') {
            await app.stripe.refund(piId, 'order-expired');
            await markProcessed(event.id, event);
            return reply.status(200).send({ ok: true, refunded: true, reason: 'expired' });
          }
          // Order already paid by payment_intent.succeeded — idempotent
          if (staleOrder?.status === 'paid') {
            await markProcessed(event.id, event);
            return reply.status(200).send({ ok: true, deduped: true });
          }
        }
        throw err;
      }
    }

    if (event.type === 'checkout.session.expired') {
      const expiredCartId = session.metadata?.cartId;
      if (expiredCartId) {
        return handleCartFailure(expiredCartId, event, request, reply);
      }
      const sessionOrderId = session.metadata?.orderId;
      if (sessionOrderId) {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: { id: sessionOrderId, status: 'pending' },
            data: { status: 'failed', failedAt: new Date() },
          });
          if (updated.count === 1) {
            const order = await tx.order.findUniqueOrThrow({ where: { id: sessionOrderId } });
            if (order.kind === 'ticket' && order.tierId) {
              await tx.ticketTier.updateMany({
                where: { id: order.tierId, quantitySold: { gte: order.quantity } },
                data: { quantitySold: { decrement: order.quantity } },
              });
            }
            const orderExtras = await tx.orderExtra.findMany({
              where: { orderId: sessionOrderId },
              select: { extraId: true, quantity: true },
            });
            for (const { extraId, quantity } of orderExtras) {
              await tx.ticketExtra.updateMany({
                where: { id: extraId, quantitySold: { gte: quantity } },
                data: { quantitySold: { decrement: quantity } },
              });
            }
          }
        });
        const firstTime = await markProcessed(event.id, event);
        return reply.status(200).send({ ok: true, deduped: !firstTime });
      }
    }

    if (event.type === 'payment_intent.payment_failed' && cartId) {
      return handleCartFailure(cartId, event, request, reply);
    }

    if (event.type === 'payment_intent.payment_failed' && orderId) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.order.updateMany({
          where: { id: orderId, status: 'pending' },
          data: { status: 'failed', failedAt: new Date() },
        });
        if (updated.count === 1) {
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          if (order.kind === 'ticket' && order.tierId) {
            await tx.ticketTier.updateMany({
              where: { id: order.tierId, quantitySold: { gte: order.quantity } },
              data: { quantitySold: { decrement: order.quantity } },
            });
          }
          // Release extras stock
          const orderExtras = await tx.orderExtra.findMany({
            where: { orderId },
            select: { extraId: true, quantity: true },
          });
          for (const { extraId, quantity } of orderExtras) {
            await tx.ticketExtra.updateMany({
              where: { id: extraId, quantitySold: { gte: quantity } },
              data: { quantitySold: { decrement: quantity } },
            });
          }
        }
      });
      const firstTime = await markProcessed(event.id, event);
      return reply.status(200).send({ ok: true, deduped: !firstTime });
    }

    return reply.status(200).send({ ok: true, ignored: true });
  });
};
