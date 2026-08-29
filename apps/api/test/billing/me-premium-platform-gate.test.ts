/**
 * Task 5 — platform gate on the me-premium WRITE routes.
 *
 * Hiding the button client-side does not close the route. `/checkout` and
 * `/checkout-precheck` are entry points into starting a NEW subscription, so
 * they refuse with 403 PlatformNotSupported when the caller's platform has
 * subscriptions disabled (Task 2's `request.subscriptionsEnabled`).
 *
 * `/billing-portal` is deliberately NOT gated here: it lets a member who
 * already has a live Stripe subscription manage what they bought (update
 * card, see invoices, cancel). Gating it would lock out an existing
 * subscriber on the very platform this feature exists to protect. A test
 * below asserts it stays reachable from a gated platform.
 *
 * Pattern mirrors me-premium.test.ts: Testcontainers Postgres via global
 * setup, FakeStripe injected through buildApp({ stripe }), env flags toggled
 * on process.env BEFORE loadEnv(), restored in afterEach.
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

const buildPremiumApp = async (): Promise<{ app: FastifyInstance; stripe: FakeStripe }> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
  process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = 'price_monthly_test';
  process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = 'price_annual_test';
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

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const originalMonthly = process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
const originalAnnual = process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
const originalIos = process.env.PREMIUM_SUBSCRIPTIONS_IOS;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  if (originalMonthly === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = originalMonthly;
  if (originalAnnual === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = originalAnnual;
  if (originalIos === undefined) delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
  else process.env.PREMIUM_SUBSCRIPTIONS_IOS = originalIos;
};

describe('platform gate on POST /api/me/premium/checkout', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('refuses subscription checkout from a gated platform', async () => {
    ({ app } = await buildPremiumApp());
    const env = loadEnv();
    const { user } = await createUser({ email: 'gated_checkout@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user'), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(403);
    expect(json(res)).toMatchObject({ error: 'PlatformNotSupported' });
  });

  it('still allows the same call from web', async () => {
    ({ app } = await buildPremiumApp());
    const env = loadEnv();
    const { user } = await createUser({ email: 'web_checkout@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user'), 'x-ccc-platform': 'web' },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(201);
  });
});

describe('platform gate on GET /api/me/premium/checkout-precheck', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('refuses precheck from a gated platform', async () => {
    ({ app } = await buildPremiumApp());
    const env = loadEnv();
    const { user } = await createUser({ email: 'gated_precheck@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user'), 'x-ccc-platform': 'ios' },
    });

    expect(res.statusCode).toBe(403);
    expect(json(res)).toMatchObject({ error: 'PlatformNotSupported' });
  });

  it('still allows the same call from web', async () => {
    ({ app } = await buildPremiumApp());
    const env = loadEnv();
    const { user } = await createUser({ email: 'web_precheck@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user'), 'x-ccc-platform': 'web' },
    });

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(200);
  });
});

describe('platform gate does NOT block POST /api/me/premium/billing-portal', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('a member managing an existing Stripe subscription is not refused on a gated platform', async () => {
    ({ app } = await buildPremiumApp());
    const env = loadEnv();
    const { user } = await createUser({ email: 'gated_portal@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_gated_portal');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user'), 'x-ccc-platform': 'ios' },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(200);
    expect(json(res).url).toBe(PORTAL_URL);
  });
});
