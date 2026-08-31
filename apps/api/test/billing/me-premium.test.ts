/**
 * Integration tests for GET/POST /api/me/premium/* (chunk F8.09).
 *
 * Pattern mirrors stripe-billing-webhook.test.ts:
 *   - Testcontainers Postgres via the global setup
 *   - FakeStripe injected through buildApp({ stripe })
 *   - Feature flag GROWTH_PREMIUM_BILLING_ENABLED toggled via process.env BEFORE
 *     each loadEnv() call. Original env restored in afterEach.
 *
 * No real Stripe API calls happen — FakeStripe returns deterministic values.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

const PORTAL_URL = 'https://billing.stripe.com/session/mock';
const CHECKOUT_URL = 'https://checkout.stripe.com/pay/cs_test_mock';

const buildPremiumApp = async (
  flagEnabled: boolean,
  priceEnv: { monthly?: string | undefined; annual?: string | undefined } = {
    monthly: 'price_monthly_test',
    annual: 'price_annual_test',
  },
): Promise<{ app: FastifyInstance; stripe: FakeStripe }> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = flagEnabled ? 'true' : 'false';
  if (priceEnv.monthly !== undefined) {
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = priceEnv.monthly;
  } else {
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  }
  if (priceEnv.annual !== undefined) {
    process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = priceEnv.annual;
  } else {
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  }
  const stripe = buildFakeStripe();
  stripe.nextSubscriptionCheckoutSession = {
    id: 'cs_test_mock',
    url: CHECKOUT_URL,
    status: 'open',
  };
  stripe.nextFoundOrCreatedCustomer = { customerId: 'cus_test_mock' };
  stripe.nextBillingPortalSession = { url: PORTAL_URL };
  const app = await buildApp(loadEnv(), { stripe });
  return { app, stripe };
};

type AnyJson = Record<string, unknown>;
const json = (res: { json: () => unknown }): AnyJson => res.json() as AnyJson;

const seedMembership = async (
  garageId: string,
  status: 'active' | 'past_due' | 'cancel_scheduled' | 'expired',
  provider: 'stripe' | 'apple_revenuecat' = 'stripe',
  providerCustomerRef = 'cus_seed',
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider,
      providerCustomerRef,
      providerSubRef: `sub_seed_${status}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
    },
  });

const seedAttempt = async (
  garageId: string,
  status: 'pending' | 'succeeded' | 'abandoned' | 'failed',
  overrides: { cadence?: 'monthly' | 'annual'; packageDigest?: string } = {},
) =>
  prisma.premiumSubscriptionAttempt.create({
    data: {
      garageId,
      cadence: overrides.cadence ?? 'monthly',
      planTier: 'gold',
      packageDigest: overrides.packageDigest ?? 'digest_test_abc',
      idempotencyKey: `sub_${garageId}_${status}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status,
    },
  });

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const originalMonthly = process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
const originalAnnual = process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  if (originalMonthly === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = originalMonthly;
  if (originalAnnual === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = originalAnnual;
};

describe('GET /api/me/premium/checkout-precheck', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('returns 200 { available: true } when user has no live membership', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'free@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
  });

  it('returns 409 AlreadySubscribed with Stripe manageUrl when active Stripe membership exists', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'active_stripe@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_active');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.error).toBe('AlreadySubscribed');
    expect(body.provider).toBe('stripe');
    expect(body.manageUrl).toBe(PORTAL_URL);
    expect(body.available).toBe(false);
  });

  it('returns 409 AlreadySubscribed with App Store deep link when active Apple membership exists', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'active_apple@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'apple_revenuecat', 'rc_app_user_id');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.error).toBe('AlreadySubscribed');
    expect(body.provider).toBe('apple_revenuecat');
    expect(body.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('returns 409 for past_due membership (user keeps access, cannot double-subscribe)', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'past_due@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'past_due');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    expect(json(res).error).toBe('AlreadySubscribed');
  });

  it('returns 409 for cancel_scheduled membership (user keeps access until period end)', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'cancelling@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'cancel_scheduled');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    expect(json(res).error).toBe('AlreadySubscribed');
  });

  it('returns 200 available=true for expired membership (user can re-subscribe)', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'expired@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'expired');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
  });

  it('returns 409 SubscriptionAttemptInFlight when a pending native attempt exists', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'native_pending@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedAttempt(garage.id, 'pending');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.available).toBe(false);
    expect(body.error).toBe('SubscriptionAttemptInFlight');
    expect(body.provider).toBeUndefined();
    expect(body.manageUrl).toBeUndefined();
  });

  it('returns 409 AlreadySubscribed (not in-flight) when both a live membership and a pending attempt exist', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'both_live_and_pending@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_both');
    await seedAttempt(garage.id, 'pending');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.error).toBe('AlreadySubscribed');
    expect(body.provider).toBe('stripe');
    expect(body.manageUrl).toBe(PORTAL_URL);
  });

  it.each(['succeeded', 'abandoned'] as const)(
    'returns 200 available=true when the only attempt row is %s, not pending',
    async (status) => {
      ({ app } = await buildPremiumApp(true));
      const env = loadEnv();
      const { user } = await createUser({
        email: `native_${status}@jdm.test`,
        verified: true,
      });
      const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
      await seedAttempt(garage.id, status);

      const res = await app.inject({
        method: 'GET',
        url: '/api/me/premium/checkout-precheck',
        headers: { authorization: bearer(env, user.id, 'user') },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ available: true });
    },
  );

  it('returns 503 when feature flag disabled', async () => {
    ({ app } = await buildPremiumApp(false));
    const env = loadEnv();
    const { user } = await createUser({ email: 'flagoff@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(503);
    expect(json(res).error).toBe('ServiceUnavailable');
  });

  it('returns 401 without auth', async () => {
    ({ app } = await buildPremiumApp(true));
    const res = await app.inject({ method: 'GET', url: '/api/me/premium/checkout-precheck' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/me/premium/checkout', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('returns 201 { url, sessionId } for monthly cadence (happy path)', async () => {
    ({ app, stripe } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'checkout_monthly@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(201);
    const body = json(res);
    expect(body.url).toBe(CHECKOUT_URL);
    expect(body.sessionId).toBe('cs_test_mock');

    // Subscription session creation was invoked with the monthly priceId.
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect(subCall).toBeDefined();
    expect((subCall!.payload as { priceIds: string[] }).priceIds).toEqual(['price_monthly_test']);
    expect((subCall!.payload as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^checkout_sub_.+_monthly_[0-9a-f]+$/,
    );
  });

  it('returns 201 for annual cadence (happy path)', async () => {
    ({ app, stripe } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'checkout_annual@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).toBe(201);
    expect(json(res).url).toContain('checkout.stripe.com');
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect((subCall!.payload as { priceIds: string[] }).priceIds).toEqual(['price_annual_test']);
  });

  it('findOrCreateCustomer called once with the user email and garageId metadata', async () => {
    ({ app, stripe } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'reuse_customer@jdm.test', verified: true });

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    const findCalls = stripe.calls.filter((c) => c.kind === 'findOrCreateCustomer');
    expect(findCalls).toHaveLength(1);
    const payload = findCalls[0]!.payload as { email: string; garageId: string };
    expect(payload.email).toBe('reuse_customer@jdm.test');
    expect(payload.garageId).toMatch(/.+/);
  });

  it('returns 409 AlreadySubscribed when live membership exists (race guard)', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'blocked_checkout@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(json(res).error).toBe('AlreadySubscribed');
  });

  it('returns 409 SubscriptionAttemptInFlight when a pending native attempt exists, before calling Stripe', async () => {
    ({ app, stripe } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'hosted_blocked_native@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    // Same cadence as requested below — proves the block is unconditional
    // (hosted checkout cannot safely reuse a native attempt's subscription
    // even when the package matches), not just a cross-package guard.
    await seedAttempt(garage.id, 'pending', { cadence: 'monthly' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.available).toBe(false);
    expect(body.error).toBe('SubscriptionAttemptInFlight');
    expect(stripe.calls.filter((c) => c.kind === 'createSubscriptionCheckoutSession')).toHaveLength(
      0,
    );
  });

  it.each(['succeeded', 'abandoned'] as const)(
    'proceeds to checkout when the only attempt row is %s, not pending',
    async (status) => {
      ({ app, stripe } = await buildPremiumApp(true));
      const env = loadEnv();
      const { user } = await createUser({
        email: `hosted_resolved_${status}@jdm.test`,
        verified: true,
      });
      const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
      await seedAttempt(garage.id, status, { cadence: 'monthly' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/me/premium/checkout',
        headers: { authorization: bearer(env, user.id, 'user') },
        payload: { cadence: 'monthly' },
      });

      expect(res.statusCode).toBe(201);
    },
  );

  it('returns 422 for invalid cadence', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'bad_cadence@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'weekly' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('returns 503 when feature flag disabled', async () => {
    ({ app } = await buildPremiumApp(false));
    const env = loadEnv();
    const { user } = await createUser({ email: 'flagoff_checkout@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('returns 503 when the price env var for the chosen cadence is missing', async () => {
    // Only monthly configured; annual absent → annual checkout should 503.
    ({ app } = await buildPremiumApp(true, { monthly: 'price_monthly_test', annual: undefined }));
    const env = loadEnv();
    const { user } = await createUser({ email: 'no_price@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).toBe(503);
    expect(json(res).error).toBe('ServiceUnavailable');
  });

  it('expires a stale open Stripe Checkout Session before minting a new one (cross-cadence)', async () => {
    ({ app, stripe } = await buildPremiumApp(true));
    stripe.nextOpenSubscriptionCheckoutSessions = [
      { id: 'cs_existing_open', url: 'https://checkout.stripe.com/pay/cs_existing_open' },
    ];
    const env = loadEnv();
    const { user } = await createUser({ email: 'dup_checkout@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).toBe(201);
    // The stale session is expired, then a new one is created.
    const expireCall = stripe.calls.find((c) => c.kind === 'expireCheckoutSession');
    expect(expireCall?.payload).toEqual({ sessionId: 'cs_existing_open' });
    const subCreate = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect(subCreate).toBeDefined();
  });

  it('mints a fresh session when the idempotency key replays a session we just expired', async () => {
    // Reproduces the production dead-end: the member asks for package A, walks
    // away, asks for package B (which expires A), then comes back to A. The
    // package-based idempotency key is unchanged, so Stripe replays A — which
    // this very handler expired — and the member lands on a dead Checkout page
    // with a 201 and no error anywhere.
    ({ app, stripe } = await buildPremiumApp(true));
    stripe.nextSubscriptionCheckoutSession = {
      id: 'cs_replayed_dead',
      url: 'https://checkout.stripe.com/pay/cs_replayed_dead',
      status: 'expired',
    };
    stripe.subscriptionCheckoutSessionQueue = [
      // First create → Stripe replays the session the expire loop just killed.
      {
        id: 'cs_replayed_dead',
        url: 'https://checkout.stripe.com/pay/cs_replayed_dead',
        status: 'expired',
      },
      // Retry under a key derived from the dead id → a genuinely new session.
      { id: 'cs_fresh_open', url: 'https://checkout.stripe.com/pay/cs_fresh_open', status: 'open' },
    ];
    const env = loadEnv();
    const { user } = await createUser({ email: 'replayed@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(201);
    expect(json(res).sessionId).toBe('cs_fresh_open');

    const creates = stripe.calls.filter((c) => c.kind === 'createSubscriptionCheckoutSession') as {
      payload: { idempotencyKey: string };
    }[];
    expect(creates).toHaveLength(2);
    const firstKey = creates[0]?.payload.idempotencyKey;
    const retryKey = creates[1]?.payload.idempotencyKey;
    // The retry key must differ, or Stripe replays the dead session again.
    expect(retryKey).not.toBe(firstKey);
    expect(retryKey).toContain(firstKey);
  });

  it('answers 503 instead of handing the member a dead Checkout url', async () => {
    // Every mint attempt comes back non-open. Returning 201 with a dead url is
    // the bug; a 503 at least tells the client something went wrong.
    ({ app, stripe } = await buildPremiumApp(true));
    stripe.nextSubscriptionCheckoutSession = {
      id: 'cs_always_dead',
      url: 'https://checkout.stripe.com/pay/cs_always_dead',
      status: 'expired',
    };
    const env = loadEnv();
    const { user } = await createUser({ email: 'always_dead@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(503);
    expect(json(res).error).toBe('ServiceUnavailable');
  });
});

describe('POST /api/me/premium/billing-portal', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('returns 200 { url } for a Stripe-billed user with active membership', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'portal@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_portal_test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(200);
    expect(json(res).url).toBe(PORTAL_URL);
  });

  it('returns 409 StaleBillingReference when the Stripe customer no longer exists', async () => {
    // Production ran entirely in test mode, so live rows carry `cus_test_...`.
    // Under a live key Stripe raises resource_missing, and this call had no
    // try/catch: an unhandled 500 that repeats forever, locking that member out
    // of ever subscribing again. Retrying never fixes it — only a purge does —
    // so the answer must be a typed 409, not a 5xx.
    const { app: builtApp, stripe } = await buildPremiumApp(true);
    app = builtApp;
    const env = loadEnv();
    const { user } = await createUser({ email: 'stale@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_test_stale_ref');

    stripe.nextBillingPortalError = Object.assign(new Error('No such customer'), {
      code: 'resource_missing',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ error: 'StaleBillingReference' });
  });

  it('still propagates unrelated Stripe failures instead of masking them as stale', async () => {
    const { app: builtApp, stripe } = await buildPremiumApp(true);
    app = builtApp;
    const env = loadEnv();
    const { user } = await createUser({ email: 'boom@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_portal_boom');

    stripe.nextBillingPortalError = new Error('stripe is down');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(500);
  });

  it('returns 404 when user has no active membership', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'no_portal@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(404);
    expect(json(res).error).toBe('NotFound');
  });

  it('returns 409 NotStripeSubscription for apple_revenuecat members', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'apple_portal@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'apple_revenuecat');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(409);
    const body = json(res);
    expect(body.error).toBe('NotStripeSubscription');
    expect(body.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('returns 503 when feature flag disabled', async () => {
    ({ app } = await buildPremiumApp(false));
    const env = loadEnv();
    const { user } = await createUser({ email: 'flagoff_portal@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('rejects off-origin returnUrl and falls back to default (open-redirect guard)', async () => {
    let stripe: FakeStripe;
    ({ app, stripe } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'redir_portal@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_redir_test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://evil.example.com/phish' },
    });

    expect(res.statusCode).toBe(200);
    const portalCall = stripe.calls.find((c) => c.kind === 'createBillingPortalSession');
    expect(portalCall).toBeDefined();
    // The off-origin returnUrl is dropped; the handler uses the default APP_WEB_BASE_URL/me/billing.
    expect((portalCall!.payload as { returnUrl: string }).returnUrl).toBe(
      'http://localhost:3000/me/billing',
    );
  });

  it('accepts same-origin returnUrl', async () => {
    let stripe: FakeStripe;
    ({ app, stripe } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'ok_portal@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_ok_test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'http://localhost:3000/garage/billing-success' },
    });

    expect(res.statusCode).toBe(200);
    const portalCall = stripe.calls.find((c) => c.kind === 'createBillingPortalSession');
    expect((portalCall!.payload as { returnUrl: string }).returnUrl).toBe(
      'http://localhost:3000/garage/billing-success',
    );
  });

  it('rejects malformed returnUrl with 422', async () => {
    ({ app } = await buildPremiumApp(true));
    const env = loadEnv();
    const { user } = await createUser({ email: 'bad_portal@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_bad_test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'not-a-url' },
    });

    expect(res.statusCode).toBe(422);
  });
});
