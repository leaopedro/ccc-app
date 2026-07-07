import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the StripeClient shape by verifying the method exists and resolves
// to an object with the expected fields. We mock the stripe SDK internals.
// This is the minimal test that pins the interface — the full reconcile tests
// in workers/billing-reconcile.test.ts exercise the integration path.

import { buildStripe } from '../../src/services/stripe/index.js';

vi.mock('stripe', () => {
  const fakeSub = {
    id: 'sub_123',
    status: 'active',
    items: {
      data: [
        {
          // Stripe dahlia API moved current_period_{start,end} onto the
          // SubscriptionItem; verify our wrapper exposes it for callers.
          current_period_end: 9999999999,
          current_period_start: 9999900000,
          price: {
            id: 'price_monthly',
            metadata: { baseAmountCents: '2990', devFeePercent: '10' },
            currency: 'brl',
            recurring: { interval: 'month' },
            product: 'prod_gold',
          },
        },
      ],
    },
    customer: 'cus_abc',
    cancel_at_period_end: false,
    canceled_at: null,
  };
  return {
    default: vi.fn().mockImplementation(() => ({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(fakeSub),
      },
      paymentIntents: {
        create: vi.fn(),
        cancel: vi.fn(),
        retrieve: vi.fn(),
      },
      checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
      parseEventNotification: vi.fn(),
      refunds: { create: vi.fn() },
    })),
  };
});

describe('StripeClient.retrieveSubscription', () => {
  let client: ReturnType<typeof buildStripe>;
  beforeEach(() => {
    client = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      STRIPE_WEBHOOK_SECRET: 'whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
  });

  it('resolves with id and status', async () => {
    const sub = await client.retrieveSubscription('sub_123');
    expect(sub.id).toBe('sub_123');
    expect(sub.status).toBe('active');
  });

  it('expands items.data.price', async () => {
    const sub = await client.retrieveSubscription('sub_123');
    expect(sub.items.data[0]?.price.id).toBe('price_monthly');
    expect(sub.items.data[0]?.current_period_end).toBe(9999999999);
  });
});
