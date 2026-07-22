import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import {
  applyInvoiceRefund,
  applyMembershipEvent,
  enqueuePremiumTicketBackfillIfActivated,
  reconcileMembershipAddonsAmount,
} from '../services/billing/apply-membership-event.js';
import { normalizeStripeEvent } from '../services/billing/normalize-stripe.js';
import type {
  NormalizeStripeResult,
  StripeRefundMarker,
} from '../services/billing/normalize-stripe.js';
import type { BillingEvent } from '../services/billing/types.js';

/**
 * POST /webhooks/stripe-billing — Stripe subscription webhook (F8.04).
 *
 * Flow (canon §F8.4, §F8.5, §F8.11, §F8.15):
 *   1. Feature flag gate (GROWTH_PREMIUM_BILLING_ENABLED) → 200 + skipped.
 *   2. Verify Stripe signature against STRIPE_BILLING_WEBHOOK_SECRET.
 *      Missing/invalid → 400.
 *   3. Insert SubscriptionWebhookEvent — on P2002, inspect existing row:
 *      processedAt non-null → 200 deduped:true; null → 503 so Stripe retries
 *      (prevents silent drop when a prior attempt crashed mid-apply).
 *   4. normalizeStripeEvent → BillingEvent | StripeRefundMarker | null.
 *      Null → mark processed, return 200 ignored.
 *   5. Refund marker → resolve garage from invoice → $transaction + FOR UPDATE
 *      → applyInvoiceRefund(tx, 'stripe', ref, amount).
 *   6. BillingEvent → resolve garage (Stripe Customer.metadata for activated,
 *      PremiumMembership lookup for everything else) → $transaction +
 *      FOR UPDATE → applyMembershipEvent(tx, evt).
 *   7. Mark SubscriptionWebhookEvent.processedAt.
 *
 * Lock contract (canon §F8.5): both applyMembershipEvent and applyInvoiceRefund
 * REQUIRE the caller to hold `SELECT id FROM "Garage" WHERE id = $garageId FOR UPDATE`
 * inside the same transaction. This route is the lock owner.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export const stripeBillingWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Raw body parser is shared with the existing stripe-webhook.ts route; Fastify
  // de-duplicates if both call addContentTypeParser for the same type. To stay
  // safe we register the parser conditionally — Fastify throws on duplicate.
  // The simplest robust approach: scope this route under an encapsulated plugin
  // context. Since both routes already use Fastify's default scope, register
  // the parser here only if not already present.
  try {
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
  } catch {
    // Parser already registered by stripe-webhook.ts — no-op.
  }

  app.post('/webhooks/stripe-billing', async (request, reply) => {
    // -----------------------------------------------------------------------
    // §F8.11 — Feature flag gate
    // -----------------------------------------------------------------------
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      request.log.info(
        {},
        'stripe-billing webhook: GROWTH_PREMIUM_BILLING_ENABLED=false, skipping',
      );
      return reply.status(200).send({ ok: true, skipped: true, reason: 'flag_disabled' });
    }

    const billingSecret = app.env.STRIPE_BILLING_WEBHOOK_SECRET;
    if (!billingSecret) {
      Sentry.captureMessage(
        'stripe-billing webhook: STRIPE_BILLING_WEBHOOK_SECRET missing while flag enabled',
        {
          level: 'error',
          tags: { kind: 'billing-webhook-misconfig', provider: 'stripe' },
        },
      );
      return reply
        .status(500)
        .send({ error: 'Misconfigured', message: 'billing webhook secret missing' });
    }

    // -----------------------------------------------------------------------
    // Signature verification
    // -----------------------------------------------------------------------
    const signatureHeader =
      request.headers['stripe-signature'] ?? request.headers['webhook-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (typeof signature !== 'string' || signature.length === 0) {
      Sentry.captureMessage('stripe-billing webhook: missing signature header', {
        level: 'warning',
        tags: { kind: 'billing-webhook-signature', provider: 'stripe' },
      });
      return reply.status(400).send({ error: 'BadRequest', message: 'missing signature' });
    }

    const raw = request.body as Buffer;
    let event;
    try {
      event = await app.stripe.constructWebhookEvent(raw, signature, billingSecret);
    } catch (sigErr) {
      Sentry.withScope((scope) => {
        scope.setTag('kind', 'billing-webhook-signature');
        scope.setTag('provider', 'stripe');
        scope.setLevel('warning');
        Sentry.captureException(sigErr);
      });
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid signature' });
    }

    // -----------------------------------------------------------------------
    // §F8.15 — Layer 1 idempotency: insert SubscriptionWebhookEvent.
    // On P2002 (replay) inspect the existing row's processedAt:
    //   - non-null → safe replay, short-circuit 200 OK + deduped:true.
    //   - null     → prior attempt is mid-flight or crashed before marking
    //                processed. Return 503 so Stripe retries. Downstream apply
    //                is idempotent (SAVEPOINT-guarded invoice insert, awardXp
    //                sourceRef uniqueness, advance-only period guard).
    // The unique index (provider, providerEventId) is the dedup boundary.
    // payload is stored unconditionally (load-bearing for prod debugging).
    // -----------------------------------------------------------------------
    let webhookEventId: string;
    try {
      const record = await prisma.subscriptionWebhookEvent.create({
        data: {
          provider: 'stripe',
          providerEventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      webhookEventId = record.id;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        const existing = await prisma.subscriptionWebhookEvent.findUnique({
          where: {
            provider_providerEventId: { provider: 'stripe', providerEventId: event.id },
          },
          select: { processedAt: true },
        });

        if (existing && existing.processedAt !== null) {
          request.log.info(
            { eventId: event.id, type: event.type },
            'stripe-billing webhook: replay deduped',
          );
          return reply.status(200).send({ ok: true, deduped: true });
        }

        request.log.warn(
          { eventId: event.id, type: event.type },
          'stripe-billing webhook: concurrent or stale unprocessed event, signalling retry',
        );
        Sentry.captureMessage(
          'stripe-billing webhook: stale unprocessed event on replay, asking Stripe to retry',
          {
            level: 'warning',
            tags: { kind: 'billing-webhook-replay-stale', provider: 'stripe' },
            extra: { eventId: event.id, type: event.type },
          },
        );
        return reply
          .status(503)
          .send({ error: 'Processing', message: 'concurrent or stale unprocessed event, retry' });
      }
      throw err;
    }

    // -----------------------------------------------------------------------
    // P5 additive seam — add-ons amount sync.
    // On ANY customer.subscription.updated, re-derive
    // PremiumMembership.addonsAmountCents from the active add-on rows (the same
    // rule attach/detach use). This is intentionally SEPARATE from the tier/
    // status normalization below — it only touches addonsAmountCents. Runs in
    // its own tx + garage lock. No-op when the subscription/membership or its
    // garage is unknown. Kept before the normalize dispatch so it applies even
    // to updates that normalize to null (e.g. an item add/remove that does not
    // flip cancel_at_period_end or swap the base price).
    // -----------------------------------------------------------------------
    if (event.type === 'customer.subscription.updated') {
      const subObj = event.data.object as { id?: string };
      const subRef = subObj.id;
      if (subRef) {
        const membershipRow = await prisma.premiumMembership.findUnique({
          where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: subRef } },
          select: { garageId: true },
        });
        if (membershipRow) {
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${membershipRow.garageId} FOR UPDATE`;
            await reconcileMembershipAddonsAmount(tx, 'stripe', subRef);
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Normalize event
    // -----------------------------------------------------------------------
    const normalized: NormalizeStripeResult = normalizeStripeEvent(event);

    if (normalized === null) {
      await prisma.subscriptionWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      request.log.info(
        { eventId: event.id, type: event.type },
        'stripe-billing webhook: ignored event type',
      );
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // -----------------------------------------------------------------------
    // Refund: invoice status only (canon §F8.10). Resolve garage from the
    // invoice row → take FOR UPDATE lock → applyInvoiceRefund(tx, 'stripe', ...)
    // -----------------------------------------------------------------------
    if (normalized.kind === 'charge.refunded.sub') {
      const marker: StripeRefundMarker = normalized;
      const invoiceRow = await prisma.premiumMembershipInvoice.findUnique({
        where: {
          provider_providerInvoiceRef: {
            provider: 'stripe',
            providerInvoiceRef: marker.invoiceRef,
          },
        },
        select: { membership: { select: { garageId: true } } },
      });

      if (!invoiceRow) {
        // Unknown invoice — safe to ignore; the SubscriptionWebhookEvent row
        // is still persisted for audit.
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        request.log.info(
          { eventId: event.id, invoiceRef: marker.invoiceRef },
          'stripe-billing webhook: charge.refunded for unknown invoice, ignored',
        );
        return reply.status(200).send({ ok: true, ignored: true, reason: 'unknown-invoice' });
      }

      const garageId = invoiceRow.membership.garageId;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
        await applyInvoiceRefund(tx, 'stripe', marker.invoiceRef, marker.refundedAmountCents);
      });

      await prisma.subscriptionWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      request.log.info(
        { eventId: event.id, invoiceRef: marker.invoiceRef, garageId },
        'stripe-billing webhook: charge.refunded applied',
      );
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------
    // Resolve garageId for membership events
    // -----------------------------------------------------------------------
    const billingEvt: BillingEvent = normalized;

    let garageId: string;

    if (billingEvt.kind === 'subscription.activated') {
      const customer = await app.stripe.retrieveCustomer(billingEvt.providerCustomerRef);
      const fromMeta = customer.metadata?.garageId;
      if (fromMeta) {
        garageId = fromMeta;
      } else {
        request.log.warn(
          { eventId: event.id, customerId: billingEvt.providerCustomerRef },
          'stripe-billing webhook: activated event missing garageId in customer metadata',
        );
        Sentry.captureMessage('stripe-billing webhook: missing garageId in customer metadata', {
          level: 'warning',
          extra: { customerId: billingEvt.providerCustomerRef },
        });
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        return reply.status(200).send({ ok: true, ignored: true, reason: 'missing-garage-id' });
      }
      // Patch garageId into the BillingEvent (normalizer left it as placeholder).
      billingEvt.garageId = garageId;
    } else {
      // All non-activated events identify the membership by providerSubRef.
      const existing = await prisma.premiumMembership.findUnique({
        where: {
          provider_providerSubRef: {
            provider: 'stripe',
            providerSubRef: billingEvt.providerSubRef,
          },
        },
        select: { garageId: true },
      });
      if (!existing) {
        // Event for an unknown subscription — mark processed and skip.
        // Most likely an out-of-order delivery or a sub that pre-dates F8.
        request.log.warn(
          { eventId: event.id, providerSubRef: billingEvt.providerSubRef, kind: billingEvt.kind },
          'stripe-billing webhook: unknown subscription, skipping',
        );
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        return reply.status(200).send({ ok: true, ignored: true, reason: 'unknown-subscription' });
      }
      garageId = existing.garageId;
    }

    // -----------------------------------------------------------------------
    // §F8.5 — Open tx + SELECT FOR UPDATE on Garage, then dispatch
    // -----------------------------------------------------------------------
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, billingEvt);
    });

    // Canon §F8.4 post-commit hook: enqueue ticket backfill on activation.
    // No-op for renewal/cancel/expiry/past_due/uncancel/tier_changed.
    await enqueuePremiumTicketBackfillIfActivated(prisma, billingEvt);

    await prisma.subscriptionWebhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date() },
    });

    request.log.info(
      { eventId: event.id, type: event.type, kind: billingEvt.kind, garageId },
      'stripe-billing webhook: processed',
    );
    return reply.status(200).send({ ok: true });
  });
};
