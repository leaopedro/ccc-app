import { describe, expect, it } from 'vitest';

import {
  normalizeStripeEvent,
  UNRECOGNIZED_SHAPE,
} from '../../src/services/billing/normalize-stripe.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';

// Helper: build a minimal WebhookEvent stub.
// Cases author `previous_attributes` inline with the subscription fields for
// readability; Stripe delivers it as a SIBLING of data.object, so lift it into
// the envelope here. Without the lift these fixtures assert against a shape no
// real delivery ever has, which is how the discriminators stayed broken.
const mkEvent = (type: string, object: Record<string, unknown>): WebhookEvent => {
  const { previous_attributes: prev, ...rest } = object;
  return {
    id: `evt_test_${type.replace(/\./g, '_')}`,
    type,
    data: {
      object: rest,
      ...(prev === undefined ? {} : { previous_attributes: prev as Record<string, unknown> }),
    },
  };
};

// Same, but placing previous_attributes where Stripe actually puts it: as a
// SIBLING of data.object, not inside it. Every *.updated discriminator depends
// on this, so a fixture that nests it under object silently tests nothing.
const mkEventWithPrev = (
  type: string,
  object: Record<string, unknown>,
  previousAttributes: Record<string, unknown>,
): WebhookEvent => ({
  id: `evt_test_${type.replace(/\./g, '_')}`,
  type,
  data: { object, previous_attributes: previousAttributes },
});

// Reusable Stripe invoice object (invoice.paid)
const makeInvoice = (billingReason: string, extra: Record<string, unknown> = {}) => ({
  id: 'in_test_001',
  subscription: 'sub_test_001',
  customer: 'cus_test_001',
  billing_reason: billingReason,
  amount_paid: 4990,
  currency: 'brl',
  period_start: 1748300000,
  period_end: 1750892000,
  status_transitions: { paid_at: 1748300100 },
  lines: {
    data: [
      {
        price: {
          id: 'price_monthly_test',
          metadata: { baseAmountCents: '4536', devFeePercent: '10' },
          recurring: { interval: 'month' },
        },
      },
    ],
  },
  ...extra,
});

// Reusable Stripe subscription object (customer.subscription.updated)
const makeSubscription = (extra: Record<string, unknown> = {}) => ({
  id: 'sub_test_001',
  customer: 'cus_test_001',
  cancel_at_period_end: false,
  current_period_start: 1748300000,
  current_period_end: 1750892000,
  canceled_at: null,
  items: {
    data: [
      {
        price: {
          id: 'price_monthly_test',
          metadata: { baseAmountCents: '4536', devFeePercent: '10' },
          recurring: { interval: 'month' },
        },
      },
    ],
  },
  ...extra,
});

describe('normalizeStripeEvent', () => {
  describe('invoice.paid — billing_reason: subscription_create → activated', () => {
    it('returns activated BillingEvent with correct pricing fields', () => {
      const event = mkEvent('invoice.paid', makeInvoice('subscription_create'));
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.activated');
      if (result.kind !== 'subscription.activated') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerCustomerRef).toBe('cus_test_001');
      expect(result.providerSubRef).toBe('sub_test_001');
      // The normalizer has no DB access, so it cannot resolve a multi-line
      // invoice's plan line against the catalog. tier / baseAmountCents /
      // devFeePercent / devFeeAmountCents are all PLACEHOLDERS here — the
      // webhook route resolves them against PremiumPlanPrice and patches them
      // in before dispatch (Task 6). That resolution is covered by the route's
      // own integration tests (stripe-billing-webhook.test.ts), not this unit
      // test of the normalizer's raw output. grossAmountCents and currency are
      // real: they come straight off the invoice, not a line item.
      expect(result.tier).toBe('bronze');
      expect(result.cadence).toBe('monthly');
      expect(result.pricing.baseAmountCents).toBe(0);
      expect(result.pricing.devFeePercent).toBe(0);
      expect(result.pricing.devFeeAmountCents).toBe(0);
      expect(result.pricing.grossAmountCents).toBe(4990);
      expect(result.pricing.currency).toBe('BRL');
      expect(result.invoice.providerInvoiceRef).toBe('in_test_001');
      expect(result.currentPeriodStart).toBeInstanceOf(Date);
      expect(result.currentPeriodEnd).toBeInstanceOf(Date);
    });
  });

  describe('invoice.paid — billing_reason: subscription_cycle → renewed', () => {
    it('returns renewed BillingEvent', () => {
      const event = mkEvent('invoice.paid', makeInvoice('subscription_cycle'));
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.renewed');
      if (result.kind !== 'subscription.renewed') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.pricing.grossAmountCents).toBe(4990);
      expect(result.invoice.providerInvoiceRef).toBe('in_test_001');
    });
  });

  describe('invoice.payment_failed → past_due', () => {
    it('returns past_due BillingEvent', () => {
      const event = mkEvent('invoice.payment_failed', {
        subscription: 'sub_test_001',
        customer: 'cus_test_001',
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.past_due');
      if (result.kind !== 'subscription.past_due') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — previous_attributes at envelope level', () => {
    it('detects cancel_at_period_end flip from envelope-level previous_attributes', () => {
      const event = mkEventWithPrev(
        'customer.subscription.updated',
        makeSubscription({ cancel_at_period_end: true }),
        { cancel_at_period_end: false },
      );
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.cancelled');
      if (result.kind !== 'subscription.cancelled') return;

      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — cancel_at_period_end flip true → cancelled', () => {
    it('detects cancel_at_period_end flip from false to true', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription({ cancel_at_period_end: true }),
        previous_attributes: { cancel_at_period_end: false },
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.cancelled');
      if (result.kind !== 'subscription.cancelled') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — cancel_at_period_end flip false → uncancelled', () => {
    it('detects cancel_at_period_end flip from true to false', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription({ cancel_at_period_end: false }),
        previous_attributes: { cancel_at_period_end: true },
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.uncancelled');
      if (result.kind !== 'subscription.uncancelled') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — price swap → tier_changed', () => {
    it('detects price.id swap in items (cadence change)', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription(),
        previous_attributes: {
          items: {
            data: [
              {
                price: {
                  id: 'price_annual_test',
                  metadata: { baseAmountCents: '47880', devFeePercent: '10' },
                  recurring: { interval: 'year' },
                },
              },
            ],
          },
        },
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.tier_changed');
      if (result.kind !== 'subscription.tier_changed') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.cadence).toBe('monthly');
      // priceMetadata carries the new price's raw Stripe metadata so the route
      // can resolve devFeePercent for a tier change exactly as it does for
      // activation/renewal (Fix round 1, finding 2 — this must never be {}).
      expect(result.priceMetadata).toEqual({ baseAmountCents: '4536', devFeePercent: '10' });
    });
  });

  describe('customer.subscription.updated — no relevant diff → null', () => {
    it('returns null when no cancel_at_period_end flip or price change', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription(),
        previous_attributes: { metadata: { some: 'change' } },
      });
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('customer.subscription.deleted → expired', () => {
    it('returns expired BillingEvent', () => {
      const event = mkEvent('customer.subscription.deleted', {
        ...makeSubscription({ canceled_at: 1748300500 }),
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('subscription.expired');
      if (result.kind !== 'subscription.expired') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.cancelledAt).toBeInstanceOf(Date);
    });
  });

  describe('charge.refunded → refund marker', () => {
    it('returns charge.refunded.sub marker (not BillingEvent)', () => {
      const event = mkEvent('charge.refunded', {
        invoice: 'in_test_001',
        amount: 4990,
        amount_refunded: 4990,
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.kind).toBe('charge.refunded.sub');
      if (result.kind !== 'charge.refunded.sub') return;

      expect(result.invoiceRef).toBe('in_test_001');
      expect(result.refundedAmountCents).toBe(4990);
      expect(result.totalAmountCents).toBe(4990);
    });

    it('returns null when charge has no invoice (one-time order, not a sub charge)', () => {
      const event = mkEvent('charge.refunded', {
        invoice: null,
        payment_intent: 'pi_test',
        amount: 4990,
        amount_refunded: 4990,
      });
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('customer.subscription.created → null (ignored per §3.3)', () => {
    it('returns null for subscription.created (await invoice.paid instead)', () => {
      const event = mkEvent('customer.subscription.created', makeSubscription());
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('unrecognized payload shape → sentinel, never a silent null', () => {
    // The normalizer casts the raw payload to hand-written types, so TypeScript
    // cannot catch a Stripe API version whose invoice shape moved. If a live
    // endpoint renders the 2026+ shape, `subscription` sits under
    // parent.subscription_details and the line carries `pricing` (a price ID)
    // instead of an expanded `price`. Returning null there means the route marks
    // the event processed and answers 200: card charged, membership never
    // created, Stripe never retries. This sentinel is what makes that loud.
    const newShapeInvoice = (billingReason: string) => ({
      id: 'in_test_new_shape',
      customer: 'cus_test_001',
      billing_reason: billingReason,
      amount_paid: 4990,
      currency: 'brl',
      period_start: 1748300000,
      period_end: 1750892000,
      status_transitions: { paid_at: 1748300100 },
      parent: { subscription_details: { subscription: 'sub_test_001' } },
      lines: { data: [{ pricing: { price_details: { price: 'price_monthly_test' } } }] },
    });

    it('flags invoice.paid carrying the 2026+ subscription shape', () => {
      const result = normalizeStripeEvent(
        mkEvent('invoice.paid', newShapeInvoice('subscription_create')),
      );

      expect(result).toBe(UNRECOGNIZED_SHAPE);
    });

    it('flags invoice.paid whose subscription is known but line price is not expanded', () => {
      const result = normalizeStripeEvent(
        mkEvent('invoice.paid', {
          ...makeInvoice('subscription_create'),
          lines: { data: [{ pricing: { price_details: { price: 'price_monthly_test' } } }] },
        }),
      );

      expect(result).toBe(UNRECOGNIZED_SHAPE);
    });

    it('flags invoice.payment_failed carrying the 2026+ subscription shape', () => {
      const result = normalizeStripeEvent(
        mkEvent('invoice.payment_failed', {
          customer: 'cus_test_001',
          parent: { subscription_details: { subscription: 'sub_test_001' } },
        }),
      );

      expect(result).toBe(UNRECOGNIZED_SHAPE);
    });

    it('still returns null for a one-off invoice with no subscription anywhere', () => {
      const result = normalizeStripeEvent(
        mkEvent('invoice.paid', {
          id: 'in_test_oneoff',
          customer: 'cus_test_001',
          billing_reason: 'manual',
          amount_paid: 1000,
          currency: 'brl',
          period_start: 1748300000,
          period_end: 1750892000,
          lines: { data: [] },
        }),
      );

      expect(result).toBeNull();
    });

    it('still returns null for invoice.payment_failed with no subscription anywhere', () => {
      const result = normalizeStripeEvent(
        mkEvent('invoice.payment_failed', { customer: 'cus_test_001' }),
      );

      expect(result).toBeNull();
    });
  });

  describe('unknown event type → null', () => {
    it('returns null for unrecognised event', () => {
      const event = mkEvent('customer.discount.created', { id: 'di_test' });
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });
});
