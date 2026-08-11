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
import { openMonthlyBoxIfEligible } from '../services/box/open.js';
import { normalizeStripeEvent } from '../services/billing/normalize-stripe.js';
import type {
  NormalizeStripeResult,
  StripeRefundMarker,
} from '../services/billing/normalize-stripe.js';
import type { BillingAddonLine, BillingEvent, BillingLine } from '../services/billing/types.js';

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
/**
 * Parses devFeePercent from the plan line's Stripe Price metadata (canon
 * §F8.1 — the one value still read from metadata, never the catalog).
 * Malformed input must never reach the Prisma Int write: by the time this
 * runs, the SubscriptionWebhookEvent row is already inserted with
 * processedAt: null, so a thrown error here would poison every Stripe retry
 * into the 503 branch forever — a poison-pill event that never applies and
 * never alerts beyond a replay-stale warning. Reject anything that isn't a
 * finite value in [0, 100], fall back to 0, and alert so an operator can fix
 * the Stripe Price metadata.
 */
const parseDevFeePercent = (raw: string | undefined): number => {
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    Sentry.captureMessage('stripe-billing webhook: invalid devFeePercent in Price metadata', {
      level: 'warning',
      tags: { kind: 'billing-devfee-invalid', provider: 'stripe' },
      extra: { raw },
    });
    return 0;
  }
  return Math.trunc(n);
};

/**
 * Resolve raw provider invoice lines against the DB catalog.
 *
 * The catalog is the source of truth for tier, cadence, and base amount —
 * NOT Stripe Price metadata, which cannot be trusted to stay in sync and
 * which the old tierFromPrice() hardcoded to 'gold'. devFeePercent is the one
 * value still read from metadata (canon §F8.1), and only from the plan line.
 *
 * `plan` is null both when zero lines match a PremiumPlanPrice (unknown
 * price — an operator forgot to register it) AND when lines match MORE THAN
 * ONE DISTINCT PremiumPlanPrice (genuinely ambiguous — e.g. a plan-change
 * invoice carries a proration credit line for the old price alongside the
 * new price's line; Stripe does not contract line ordering, so picking "the
 * first match" would silently provision whichever tier happens to sort
 * first). Both cases must refuse and alert rather than guess — the caller
 * checks `!resolved.plan`.
 *
 * Ambiguity is judged by DISTINCT matched price refs, not by raw line count:
 * an invoice can legitimately carry two lines for the very same price (e.g.
 * a proration credit plus a charge for the same price across a cycle
 * boundary) without that being ambiguous at all — both resolve to the same
 * PremiumPlanPrice row and must activate/renew normally.
 */
const resolveLinesAgainstCatalog = async (lines: BillingLine[]) => {
  const priceRefs = lines.map((l) => l.priceRef);

  const [planPrices, addonModules] = await Promise.all([
    prisma.premiumPlanPrice.findMany({
      where: { stripePriceId: { in: priceRefs } },
      select: {
        stripePriceId: true,
        baseAmountCents: true,
        cadence: true,
        plan: { select: { tier: true } },
      },
    }),
    prisma.premiumAddonModule.findMany({
      where: { stripePriceId: { in: priceRefs } },
      select: {
        key: true,
        stripePriceId: true,
        monthlyDeltaCents: true,
        payoutAmountCents: true,
        vendorName: true,
        quotaPerCycle: true,
        quotaUnit: true,
        currency: true,
      },
    }),
  ]);

  const matchingPlanLines = lines.filter((l) =>
    planPrices.some((p) => p.stripePriceId === l.priceRef),
  );
  // Count DISTINCT catalog rows matched, not raw lines: two lines for the
  // same price (proration credit + charge) are one match, not two. Two
  // lines for two DIFFERENT registered prices are genuinely ambiguous and
  // must still refuse — deliberately not excluding negative-amount (credit)
  // lines from this count, since doing so would let a real plan-change
  // invoice (old price credited, new price charged) resolve to "just the new
  // price" instead of correctly refusing as ambiguous.
  const distinctPlanPriceRefs = new Set(matchingPlanLines.map((l) => l.priceRef));
  const planLine = distinctPlanPriceRefs.size === 1 ? matchingPlanLines[0] : undefined;
  const planPrice = planLine
    ? planPrices.find((p) => p.stripePriceId === planLine.priceRef)
    : undefined;

  const addons: BillingAddonLine[] = [];
  for (const line of lines) {
    const mod = addonModules.find((m) => m.stripePriceId === line.priceRef);
    if (!mod) continue;
    addons.push({
      addonKey: mod.key,
      providerItemRef: line.subscriptionItemRef,
      monthlyDeltaCents: mod.monthlyDeltaCents,
      payoutAmountCents: mod.payoutAmountCents,
      vendorName: mod.vendorName,
      quotaPerCycle: mod.quotaPerCycle,
      quotaUnit: mod.quotaUnit,
      currency: mod.currency,
    });
  }

  const devFeePercent = parseDevFeePercent(planLine?.metadata.devFeePercent);
  const baseAmountCents = planPrice?.baseAmountCents ?? 0;

  return {
    plan: planPrice ? { tier: planPrice.plan.tier, cadence: planPrice.cadence } : null,
    baseAmountCents,
    devFeePercent,
    devFeeAmountCents: Math.round((baseAmountCents * devFeePercent) / 100),
    addons,
    // Fix round 1, finding 5: this used to sum the raw Stripe invoice line
    // amounts (proration/discount included) for add-on lines. Nothing reads
    // it anymore — handleActivated now derives its own addonsAmountCents from
    // the resolved add-ons' catalog monthlyDeltaCents (matching
    // reconcileMembershipAddonsAmount and the attach/detach routes), which is
    // the only place BillingEvent.addonsAmountCents was ever consumed. The
    // field stays 0 here rather than being removed because BillingEvent still
    // requires it (types.ts is out of scope for this task); it is vestigial.
    addonsAmountCents: 0,
  };
};

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

    // Patch the catalog-resolved values into the event before dispatch, in the
    // same spirit as the garageId patch below.
    if (
      billingEvt.kind === 'subscription.activated' ||
      billingEvt.kind === 'subscription.renewed'
    ) {
      const resolved = await resolveLinesAgainstCatalog(billingEvt.lines);

      // The normalizer's tier placeholder is a VALID enum value ('bronze') and
      // its pricing placeholders are all zero, so a silent fall-through is
      // dangerous on BOTH kinds: activation would provision a paying gold
      // customer as bronze, and renewal would zero out a previously-correct
      // membership's baseAmountCents/devFeePercent (e.g. an operator retiring a
      // Stripe Price that subscribers are still billed on). Refuse and alert on
      // both rather than write zeros over — or under — a real charge.
      // Decision 2026-07-29: 200 + ignored. Stripe must NOT redeliver, because
      // the fix is an operator action in the admin catalog, not a transient
      // error.
      if (!resolved.plan) {
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        request.log.error(
          {
            eventId: event.id,
            kind: billingEvt.kind,
            priceRefs: billingEvt.lines.map((l) => l.priceRef),
          },
          'stripe-billing webhook: no single catalog plan price matched the invoice, refusing to apply',
        );
        Sentry.captureMessage(
          'stripe-billing webhook: invoice.paid with no unambiguous matching PremiumPlanPrice, apply refused',
          {
            level: 'error',
            tags: { kind: 'billing-catalog-miss', provider: 'stripe' },
            extra: {
              eventId: event.id,
              billingKind: billingEvt.kind,
              priceRefs: billingEvt.lines.map((l) => l.priceRef),
            },
          },
        );
        return reply.status(200).send({ ok: true, ignored: true, reason: 'unknown-plan-price' });
      }

      billingEvt.pricing.baseAmountCents = resolved.baseAmountCents;
      billingEvt.pricing.devFeePercent = resolved.devFeePercent;
      billingEvt.pricing.devFeeAmountCents = resolved.devFeeAmountCents;

      if (billingEvt.kind === 'subscription.activated') {
        billingEvt.tier = resolved.plan.tier;
        billingEvt.cadence = resolved.plan.cadence;
        billingEvt.addons = resolved.addons;
        billingEvt.addonsAmountCents = resolved.addonsAmountCents;
      }
    }

    // A tier_changed whose swapped price is an add-on is not a tier change at
    // all: reconcileMembershipAddonsAmount above already handled it.
    if (billingEvt.kind === 'subscription.tier_changed') {
      const resolved = await resolveLinesAgainstCatalog([
        {
          priceRef: billingEvt.priceRef,
          amountCents: 0,
          subscriptionItemRef: null,
          metadata: billingEvt.priceMetadata,
        },
      ]);
      if (!resolved.plan) {
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        request.log.info(
          { eventId: event.id, priceRef: billingEvt.priceRef },
          'stripe-billing webhook: item swap is an add-on, not a tier change',
        );
        return reply.status(200).send({ ok: true, ignored: true, reason: 'addon-item-swap' });
      }
      billingEvt.tier = resolved.plan.tier;
      billingEvt.cadence = resolved.plan.cadence;
      billingEvt.pricing.baseAmountCents = resolved.baseAmountCents;
      billingEvt.pricing.devFeePercent = resolved.devFeePercent;
      billingEvt.pricing.devFeeAmountCents = resolved.devFeeAmountCents;
      billingEvt.pricing.grossAmountCents = resolved.baseAmountCents + resolved.devFeeAmountCents;
    }

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
    // Metodo de pagamento (conveniencia para o admin, nao dado de cobranca)
    //
    // O payload de invoice.paid traz `payment_intent` como id, nao expandido,
    // entao a bandeira e o final do cartao NAO estao no evento. O normalizador e
    // puro e nao pode buscar: a resolucao fica aqui.
    //
    // Falha desta chamada nao derruba o webhook. Perder um dado de exibicao nao
    // pode impedir o processamento de uma cobranca.
    // -----------------------------------------------------------------------
    if (
      (billingEvt.kind === 'subscription.activated' ||
        billingEvt.kind === 'subscription.renewed') &&
      !billingEvt.pricing.paymentBrand
    ) {
      const paymentIntentId = (event.data.object as { payment_intent?: unknown }).payment_intent;
      if (typeof paymentIntentId === 'string' && paymentIntentId.length > 0) {
        try {
          const card = await app.stripe.retrievePaymentMethodCard(paymentIntentId);
          if (card) {
            billingEvt.pricing.paymentBrand = card.brand;
            billingEvt.pricing.paymentLast4 = card.last4;
          }
        } catch (err) {
          request.log.warn(
            { eventId: event.id, paymentIntentId, err },
            'stripe-billing webhook: falha ao resolver metodo de pagamento, seguindo sem ele',
          );
        }
      }
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
    // Box Builder Fase 2: open the current-cycle box post-commit (best-effort).
    await openMonthlyBoxIfEligible(prisma, billingEvt);

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
