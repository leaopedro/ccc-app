/**
 * Unit tests for the three new helpers added to StripeClient in F8.09:
 *  - createSubscriptionCheckoutSession
 *  - findOrCreateCustomer
 *  - createBillingPortalSession
 *
 * The Stripe SDK constructor is mocked at the module boundary so no real
 * HTTP calls are made. We assert that buildStripe wires the SDK calls
 * correctly (params, idempotencyKey, metadata).
 */

import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildStripe } from '../../src/services/stripe/index.js';

const testEnv = {
  STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'a'.repeat(26),
  STRIPE_PUBLISHABLE_KEY: undefined,
};

vi.mock('stripe', () => {
  const mockCreate = vi.fn();
  const mockList = vi.fn();
  const mockCustomersCreate = vi.fn();
  const mockCustomersUpdate = vi.fn();
  const mockPortalCreate = vi.fn();
  const mockSessionsList = vi.fn();

  const StripeConstructor = vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: { create: mockCreate, list: mockSessionsList },
    },
    customers: {
      list: mockList,
      create: mockCustomersCreate,
      update: mockCustomersUpdate,
    },
    billingPortal: {
      sessions: { create: mockPortalCreate },
    },
  }));

  (StripeConstructor as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  (StripeConstructor as unknown as Record<string, unknown>).__mockList = mockList;
  (StripeConstructor as unknown as Record<string, unknown>).__mockCustomersCreate =
    mockCustomersCreate;
  (StripeConstructor as unknown as Record<string, unknown>).__mockCustomersUpdate =
    mockCustomersUpdate;
  (StripeConstructor as unknown as Record<string, unknown>).__mockPortalCreate = mockPortalCreate;
  (StripeConstructor as unknown as Record<string, unknown>).__mockSessionsList = mockSessionsList;

  return { default: StripeConstructor };
});

const getMocks = () => {
  const Constructor = Stripe as unknown as {
    __mockCreate: ReturnType<typeof vi.fn>;
    __mockList: ReturnType<typeof vi.fn>;
    __mockCustomersCreate: ReturnType<typeof vi.fn>;
    __mockCustomersUpdate: ReturnType<typeof vi.fn>;
    __mockPortalCreate: ReturnType<typeof vi.fn>;
    __mockSessionsList: ReturnType<typeof vi.fn>;
  };
  return {
    mockCreate: Constructor.__mockCreate,
    mockList: Constructor.__mockList,
    mockCustomersCreate: Constructor.__mockCustomersCreate,
    mockCustomersUpdate: Constructor.__mockCustomersUpdate,
    mockPortalCreate: Constructor.__mockPortalCreate,
    mockSessionsList: Constructor.__mockSessionsList,
  };
};

describe('createSubscriptionCheckoutSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls stripe.checkout.sessions.create with mode=subscription and subscription_data.metadata', async () => {
    const { mockCreate } = getMocks();
    mockCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
    });

    const client = buildStripe(testEnv);
    const result = await client.createSubscriptionCheckoutSession({
      customerId: 'cus_abc',
      priceIds: ['price_monthly'],
      successUrl: 'https://app.jdm.com/premium/success',
      cancelUrl: 'https://app.jdm.com/premium',
      metadata: { garageId: 'garage_1', userId: 'user_1' },
      idempotencyKey: 'checkout_sub_garage_1_monthly',
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const [params, options] = mockCreate.mock.calls[0] as [
      Stripe.Checkout.SessionCreateParams,
      { idempotencyKey: string },
    ];
    expect(params.mode).toBe('subscription');
    expect(params.customer).toBe('cus_abc');
    expect(params.line_items).toHaveLength(1);
    expect((params.line_items![0] as { price: string }).price).toBe('price_monthly');
    expect(
      (params.subscription_data as { metadata: Record<string, string> }).metadata.garageId,
    ).toBe('garage_1');
    expect(params.success_url).toBe('https://app.jdm.com/premium/success');
    expect(params.cancel_url).toBe('https://app.jdm.com/premium');
    expect(params.metadata).toEqual({ garageId: 'garage_1', userId: 'user_1' });
    expect(options.idempotencyKey).toBe('checkout_sub_garage_1_monthly');
    expect(result).toEqual({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
    });
  });

  it('throws if session has no url', async () => {
    const { mockCreate } = getMocks();
    mockCreate.mockResolvedValue({ id: 'cs_test_123', url: null });

    const client = buildStripe(testEnv);
    await expect(
      client.createSubscriptionCheckoutSession({
        customerId: 'cus_abc',
        priceIds: ['price_monthly'],
        successUrl: 'https://app.jdm.com/premium/success',
        cancelUrl: 'https://app.jdm.com/premium',
        metadata: {},
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrow('stripe subscription checkout session missing url');
  });
});

describe('findOrCreateCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing customer when found by email AND metadata already matches', async () => {
    const { mockList, mockCustomersCreate, mockCustomersUpdate } = getMocks();
    mockList.mockResolvedValue({
      data: [{ id: 'cus_existing', metadata: { garageId: 'garage_1' } }],
    });

    const client = buildStripe(testEnv);
    const result = await client.findOrCreateCustomer({
      email: 'rider@jdm.com',
      garageId: 'garage_1',
    });

    expect(mockList).toHaveBeenCalledWith({ email: 'rider@jdm.com', limit: 10 });
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    // Metadata already in sync — no update call.
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ customerId: 'cus_existing' });
  });

  it('refreshes metadata.garageId on reuse when it is missing or stale', async () => {
    const { mockList, mockCustomersUpdate } = getMocks();
    mockList.mockResolvedValue({
      data: [{ id: 'cus_stale', metadata: { garageId: 'garage_OLD' } }],
    });

    const client = buildStripe(testEnv);
    await client.findOrCreateCustomer({
      email: 'rider@jdm.com',
      garageId: 'garage_NEW',
    });

    expect(mockCustomersUpdate).toHaveBeenCalledWith('cus_stale', {
      metadata: { garageId: 'garage_NEW' },
    });
  });

  it('skips deleted Stripe customers and returns next live one', async () => {
    const { mockList, mockCustomersCreate } = getMocks();
    mockList.mockResolvedValue({
      data: [
        { id: 'cus_deleted', deleted: true },
        { id: 'cus_live', metadata: { garageId: 'garage_x' } },
      ],
    });

    const client = buildStripe(testEnv);
    const result = await client.findOrCreateCustomer({
      email: 'recycled@jdm.com',
      garageId: 'garage_x',
    });

    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ customerId: 'cus_live' });
  });

  it('creates a new customer when only deleted ones match', async () => {
    const { mockList, mockCustomersCreate } = getMocks();
    mockList.mockResolvedValue({ data: [{ id: 'cus_deleted', deleted: true }] });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_fresh' });

    const client = buildStripe(testEnv);
    const result = await client.findOrCreateCustomer({
      email: 'all_deleted@jdm.com',
      garageId: 'garage_y',
    });

    expect(mockCustomersCreate).toHaveBeenCalledOnce();
    expect(result).toEqual({ customerId: 'cus_fresh' });
  });

  it('creates a new customer with garageId metadata when none found', async () => {
    const { mockList, mockCustomersCreate } = getMocks();
    mockList.mockResolvedValue({ data: [] });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });

    const client = buildStripe(testEnv);
    const result = await client.findOrCreateCustomer({
      email: 'new@jdm.com',
      garageId: 'garage_2',
    });

    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: 'new@jdm.com',
      metadata: { garageId: 'garage_2' },
    });
    expect(result).toEqual({ customerId: 'cus_new' });
  });
});

describe('createBillingPortalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls billingPortal.sessions.create and returns url', async () => {
    const { mockPortalCreate } = getMocks();
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' });

    const client = buildStripe(testEnv);
    const result = await client.createBillingPortalSession({
      customerId: 'cus_abc',
      returnUrl: 'https://app.jdm.com/me/billing',
    });

    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_abc',
      return_url: 'https://app.jdm.com/me/billing',
    });
    expect(result).toEqual({ url: 'https://billing.stripe.com/session/abc' });
  });
});

describe('listOpenSubscriptionCheckoutSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries checkout.sessions.list with status=open + filters subscription mode', async () => {
    const { mockSessionsList } = getMocks();
    mockSessionsList.mockResolvedValue({
      data: [
        { id: 'cs_sub_1', mode: 'subscription', url: 'https://checkout.stripe.com/pay/cs_sub_1' },
        { id: 'cs_pay_1', mode: 'payment', url: 'https://checkout.stripe.com/pay/cs_pay_1' },
        { id: 'cs_sub_2', mode: 'subscription', url: 'https://checkout.stripe.com/pay/cs_sub_2' },
      ],
    });

    const client = buildStripe(testEnv);
    const result = await client.listOpenSubscriptionCheckoutSessions('cus_abc');

    expect(mockSessionsList).toHaveBeenCalledWith({
      customer: 'cus_abc',
      status: 'open',
      limit: 10,
    });
    expect(result).toEqual([
      { id: 'cs_sub_1', url: 'https://checkout.stripe.com/pay/cs_sub_1' },
      { id: 'cs_sub_2', url: 'https://checkout.stripe.com/pay/cs_sub_2' },
    ]);
  });

  it('returns [] when no open sessions', async () => {
    const { mockSessionsList } = getMocks();
    mockSessionsList.mockResolvedValue({ data: [] });

    const client = buildStripe(testEnv);
    const result = await client.listOpenSubscriptionCheckoutSessions('cus_abc');

    expect(result).toEqual([]);
  });
});
