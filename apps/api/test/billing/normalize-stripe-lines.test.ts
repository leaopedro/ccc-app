import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../src/services/billing/normalize-stripe.js';

const invoicePaidEvent = () => ({
  id: 'evt_lines_1',
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_lines_1',
      subscription: 'sub_lines_1',
      customer: 'cus_lines_1',
      billing_reason: 'subscription_create',
      amount_paid: 164000,
      currency: 'brl',
      period_start: 1767225600,
      period_end: 1769904000,
      status_transitions: { paid_at: 1767225600 },
      lines: {
        data: [
          {
            price: {
              id: 'price_plan_gold',
              metadata: { devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
            amount: 149000,
            subscription_item: 'si_plan',
          },
          {
            price: {
              id: 'price_addon_detailing',
              metadata: {},
              recurring: { interval: 'month' },
            },
            amount: 15000,
            subscription_item: 'si_addon',
          },
        ],
      },
    },
  },
});

describe('normalizeStripeEvent — invoice lines', () => {
  it('carries every invoice line with its price ref, amount and item ref', () => {
    const result = normalizeStripeEvent(invoicePaidEvent());
    expect(result).not.toBeNull();
    if (!result || result.kind !== 'subscription.activated') throw new Error('wrong kind');

    expect(result.lines).toEqual([
      {
        priceRef: 'price_plan_gold',
        amountCents: 149000,
        subscriptionItemRef: 'si_plan',
        metadata: { devFeePercent: '10' },
      },
      {
        priceRef: 'price_addon_detailing',
        amountCents: 15000,
        subscriptionItemRef: 'si_addon',
        metadata: {},
      },
    ]);
  });

  it('leaves tier, baseAmountCents and devFeePercent as placeholders for the route', () => {
    const result = normalizeStripeEvent(invoicePaidEvent());
    if (!result || result.kind !== 'subscription.activated') throw new Error('wrong kind');

    expect(result.tier).toBe('bronze');
    expect(result.pricing.baseAmountCents).toBe(0);
    expect(result.pricing.devFeePercent).toBe(0);
    expect(result.addons).toEqual([]);
    expect(result.addonsAmountCents).toBe(0);
    // grossAmountCents and currency are real — they come from the invoice itself.
    expect(result.pricing.grossAmountCents).toBe(164000);
    expect(result.pricing.currency).toBe('BRL');
  });
});
