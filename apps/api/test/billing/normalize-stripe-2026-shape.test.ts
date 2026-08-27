/**
 * The 2026 invoice shape.
 *
 * Every fixture here is copied from a REAL delivery: `evt_1U8oTrBl1stGgSds2ARCLgem`,
 * an `invoice.paid` for `sub_1U8oTqBl1stGgSdsQBOw3Coh` (Box Bronze 49,90 +
 * Lavagem 69,90), which arrived in production on 2026-08-26 and was refused as
 * `UNRECOGNIZED_SHAPE`. The card was charged and no membership was created.
 *
 * Why the old shape stopped arriving: `docs/stripe.md` §0 assumed pinning the
 * webhook endpoint to `2026-04-22.dahlia` would keep rendering
 * `invoice.subscription` at the top level and an expanded `line.price`. It does
 * not. Re-rendering the same invoice across versions shows the restructure
 * landed BEFORE that version:
 *
 *   2026-04-22.dahlia  subscription=absent  line.price=absent
 *   2025-08-27.basil   subscription=absent  line.price=absent
 *   2024-06-20         subscription=present line.price=present
 *
 * So no endpoint pin recovers the old shape, and the normalizer has to read the
 * new one. What the new shape still carries:
 *
 *   subscription        → parent.subscription_details.subscription
 *   priceRef            → lines[].pricing.price_details.price   (bare id)
 *   subscriptionItemRef → lines[].parent.subscription_item_details.subscription_item
 *   garageId / cadence  → parent.subscription_details.metadata  (ours, set by me-premium.ts)
 *
 * What it does NOT carry is the Price's own metadata, so `devFeePercent` is
 * absent here by construction — the route fetches it. `recurring.interval` is
 * likewise gone, which is harmless because cadence was always a placeholder the
 * route overwrites from PremiumPlanPrice.cadence.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeStripeEvent,
  UNRECOGNIZED_SHAPE,
} from '../../src/services/billing/normalize-stripe.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';

const mkEvent = (type: string, object: Record<string, unknown>): WebhookEvent => ({
  id: 'evt_1U8oTrBl1stGgSds2ARCLgem',
  type,
  data: { object },
});

/** Verbatim 2026-shape line, as delivered. */
const newShapeLine = (priceId: string, amount: number, itemRef: string) => ({
  id: `il_${priceId}`,
  amount,
  currency: 'brl',
  // The period actually paid for. Verbatim from the real delivery: the invoice
  // level is a zero-length window at the creation instant, the line is not.
  period: { start: 1787780132, end: 1790458532 },
  metadata: { cadence: 'monthly', garageId: 'gar_1', userId: 'usr_1' },
  pricing: {
    type: 'price_details',
    price_details: { price: priceId, product: 'prod_x' },
    unit_amount_decimal: String(amount),
  },
  parent: {
    type: 'subscription_item_details',
    invoice_item_details: null,
    subscription_item_details: {
      invoice_item: null,
      proration: false,
      proration_details: { credited_items: null },
      subscription: 'sub_1U8oTqBl1stGgSdsQBOw3Coh',
      subscription_item: itemRef,
    },
  },
});

const newShapeInvoice = (billingReason: string) => ({
  id: 'in_1U8oToBl1stGgSds7OQwLbHx',
  customer: 'cus_V915blOMLuhf3I',
  billing_reason: billingReason,
  amount_paid: 11980,
  currency: 'brl',
  // Zero-length, exactly as Stripe renders it on subscription_create.
  period_start: 1787780132,
  period_end: 1787780132,
  status_transitions: { paid_at: 1787780150 },
  // No top-level `subscription` — this is the whole point.
  parent: {
    type: 'subscription_details',
    subscription_details: {
      subscription: 'sub_1U8oTqBl1stGgSdsQBOw3Coh',
      metadata: { cadence: 'monthly', garageId: 'gar_1', userId: 'usr_1' },
    },
  },
  lines: {
    data: [
      newShapeLine('price_1U4LKEBl1stGgSdsLVFaemcW', 4990, 'si_V96hzZw1rJDAXy'),
      newShapeLine('price_1U8ipeBl1stGgSdsQDzQFZWr', 6990, 'si_V96h8omprg3k6M'),
    ],
  },
});

describe('normalizeStripeEvent — 2026 invoice shape', () => {
  it('activates from a real 2026-shape invoice.paid instead of refusing it', () => {
    const out = normalizeStripeEvent(
      mkEvent('invoice.paid', newShapeInvoice('subscription_create')),
    );

    expect(out).not.toBe(UNRECOGNIZED_SHAPE);
    if (!out || out.kind !== 'subscription.activated') {
      throw new Error(`esperava subscription.activated, veio ${JSON.stringify(out)}`);
    }
    expect(out.providerSubRef).toBe('sub_1U8oTqBl1stGgSdsQBOw3Coh');
    expect(out.providerCustomerRef).toBe('cus_V915blOMLuhf3I');
    expect(out.pricing.grossAmountCents).toBe(11980);
    expect(out.pricing.currency).toBe('BRL');
  });

  it('reads priceRef from pricing.price_details.price on every line', () => {
    const out = normalizeStripeEvent(
      mkEvent('invoice.paid', newShapeInvoice('subscription_create')),
    );
    if (!out || out.kind !== 'subscription.activated') throw new Error('shape errada');

    expect(out.lines.map((l) => l.priceRef)).toEqual([
      'price_1U4LKEBl1stGgSdsLVFaemcW',
      'price_1U8ipeBl1stGgSdsQDzQFZWr',
    ]);
    expect(out.lines.map((l) => l.amountCents)).toEqual([4990, 6990]);
  });

  it('reads subscriptionItemRef from parent.subscription_item_details', () => {
    // Load-bearing: the add-on rows key off this ref, so losing it silently
    // detaches every module from the membership.
    const out = normalizeStripeEvent(
      mkEvent('invoice.paid', newShapeInvoice('subscription_create')),
    );
    if (!out || out.kind !== 'subscription.activated') throw new Error('shape errada');

    expect(out.lines.map((l) => l.subscriptionItemRef)).toEqual([
      'si_V96hzZw1rJDAXy',
      'si_V96h8omprg3k6M',
    ]);
  });

  it('leaves devFeePercent at the placeholder — the payload cannot carry it', () => {
    const out = normalizeStripeEvent(
      mkEvent('invoice.paid', newShapeInvoice('subscription_create')),
    );
    if (!out || out.kind !== 'subscription.activated') throw new Error('shape errada');

    // The route fetches the Price to fill this. Asserted so nobody "fixes" the
    // normalizer by inventing a value from the line metadata, which is the
    // SUBSCRIPTION's metadata mirrored onto the line, not the Price's.
    expect(out.pricing.devFeePercent).toBe(0);
    expect(out.lines[0]?.metadata.devFeePercent).toBeUndefined();
  });

  it('takes the billed period from the line, not the zero-length invoice window', () => {
    // The bug this pins: on a subscription_create invoice the invoice-level
    // period is a single instant, so reading it wrote a currentPeriodEnd already
    // in the past. computeIsPremiumActive answers `premiumUntil > now`, so a
    // member who had just paid came out NOT premium, and every add-on got a
    // zero-length quota cycle. The real period lives on the line.
    const out = normalizeStripeEvent(
      mkEvent('invoice.paid', newShapeInvoice('subscription_create')),
    );
    if (!out || out.kind !== 'subscription.activated') throw new Error('shape errada');

    expect(out.currentPeriodStart).toEqual(new Date(1787780132 * 1000));
    expect(out.currentPeriodEnd).toEqual(new Date(1790458532 * 1000));
    expect(out.currentPeriodEnd.getTime()).toBeGreaterThan(out.currentPeriodStart.getTime());
    // The stored invoice row describes the same billed window.
    expect(out.invoice.periodStart).toEqual(new Date(1787780132 * 1000));
    expect(out.invoice.periodEnd).toEqual(new Date(1790458532 * 1000));
  });

  it('falls back to the invoice period when the line carries none', () => {
    const noLinePeriod = newShapeInvoice('subscription_create');
    noLinePeriod.period_end = 1790372000;
    for (const l of noLinePeriod.lines.data) {
      delete (l as { period?: unknown }).period;
    }

    const out = normalizeStripeEvent(mkEvent('invoice.paid', noLinePeriod));
    if (!out || out.kind !== 'subscription.activated') throw new Error('shape errada');

    expect(out.currentPeriodEnd).toEqual(new Date(1790372000 * 1000));
  });

  it('renews from a 2026-shape subscription_cycle invoice', () => {
    const out = normalizeStripeEvent(
      mkEvent('invoice.paid', newShapeInvoice('subscription_cycle')),
    );
    if (!out || out.kind !== 'subscription.renewed') {
      throw new Error(`esperava subscription.renewed, veio ${JSON.stringify(out)}`);
    }
    expect(out.providerSubRef).toBe('sub_1U8oTqBl1stGgSdsQBOw3Coh');
  });

  it('maps a 2026-shape invoice.payment_failed to past_due', () => {
    const out = normalizeStripeEvent(
      mkEvent('invoice.payment_failed', newShapeInvoice('subscription_cycle')),
    );
    if (!out || out.kind !== 'subscription.past_due') {
      throw new Error(`esperava subscription.past_due, veio ${JSON.stringify(out)}`);
    }
    expect(out.providerSubRef).toBe('sub_1U8oTqBl1stGgSdsQBOw3Coh');
  });

  it('still refuses when there is a subscription but no price ref in either shape', () => {
    // The sentinel must survive this change. A shape we genuinely cannot read
    // has to keep 503-ing rather than activating a membership from guesses.
    const broken = newShapeInvoice('subscription_create');
    broken.lines.data = [
      { id: 'il_x', amount: 4990, currency: 'brl', metadata: {} },
    ] as unknown as ReturnType<typeof newShapeLine>[];

    expect(normalizeStripeEvent(mkEvent('invoice.paid', broken))).toBe(UNRECOGNIZED_SHAPE);
  });

  it('still returns null for a non-subscription invoice', () => {
    // No subscription in EITHER shape means it is not ours; 200 + processed is
    // correct and must not become a 503 loop.
    const oneOff = { ...newShapeInvoice('manual'), parent: null };
    expect(normalizeStripeEvent(mkEvent('invoice.paid', oneOff))).toBeNull();
  });
});
