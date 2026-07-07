import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildStripe } from '../../src/services/stripe/index.js';

const testEnv = {
  STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'a'.repeat(26),
  STRIPE_PUBLISHABLE_KEY: undefined,
};

vi.mock('stripe', () => {
  const mockRetrieve = vi.fn();
  const StripeConstructor = vi.fn().mockImplementation(() => ({
    prices: { retrieve: mockRetrieve },
  }));
  (StripeConstructor as unknown as Record<string, unknown>).__mockRetrieve = mockRetrieve;
  return { default: StripeConstructor };
});

const getMocks = () => {
  const Constructor = Stripe as unknown as {
    __mockRetrieve: ReturnType<typeof vi.fn>;
  };
  return { mockRetrieve: Constructor.__mockRetrieve };
};

describe('retrievePrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Stripe.Price with metadata intact', async () => {
    const { mockRetrieve } = getMocks();
    mockRetrieve.mockResolvedValue({
      id: 'price_monthly_test',
      currency: 'brl',
      metadata: { baseAmountCents: '2990', devFeePercent: '10' },
      active: true,
    });

    const client = buildStripe(testEnv);
    const price = await client.retrievePrice('price_monthly_test');

    expect(mockRetrieve).toHaveBeenCalledWith('price_monthly_test');
    expect(price.id).toBe('price_monthly_test');
    expect(price.currency).toBe('brl');
    expect(price.metadata).toEqual({ baseAmountCents: '2990', devFeePercent: '10' });
  });

  it('propagates Stripe errors', async () => {
    const { mockRetrieve } = getMocks();
    mockRetrieve.mockRejectedValue(new Error('No such price: price_missing'));

    const client = buildStripe(testEnv);
    await expect(client.retrievePrice('price_missing')).rejects.toThrow(
      'No such price: price_missing',
    );
  });
});
