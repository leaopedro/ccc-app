/**
 * Integration tests for GET /api/premium/pricing (chunk F8.20).
 *
 * Pattern mirrors me-premium.test.ts:
 *   - Testcontainers Postgres via the global setup (the route is stateless,
 *     but the app boots Prisma either way)
 *   - FakeStripe injected through buildApp({ stripe }); the test overrides
 *     fake.retrievePrice with a vi.fn so each test can stub responses per
 *     priceId or assert call counts.
 *   - Feature flag + env vars toggled via process.env BEFORE each loadEnv()
 *     call. Original env restored in afterEach.
 *
 * No real Stripe API calls happen.
 */

import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { resetDatabase } from '../helpers.js';

type EnvOverrides = {
  flagEnabled: boolean;
  monthly?: string | undefined;
  annual?: string | undefined;
};

type ErrorBody = { error: string };
type PricingBody = {
  monthly: { currency: string; cadence: string };
  annual: { currency: string; cadence: string };
};

const errorOf = (res: { json: () => unknown }): ErrorBody => res.json() as ErrorBody;
const pricingOf = (res: { json: () => unknown }): PricingBody => res.json() as PricingBody;

const buildPricingApp = async (
  overrides: EnvOverrides,
): Promise<{ app: FastifyInstance; stripe: FakeStripe }> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = overrides.flagEnabled ? 'true' : 'false';
  if (overrides.monthly !== undefined) {
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = overrides.monthly;
  } else {
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  }
  if (overrides.annual !== undefined) {
    process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = overrides.annual;
  } else {
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  }
  const stripe = buildFakeStripe();
  const app = await buildApp(loadEnv(), { stripe });
  return { app, stripe };
};

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

const priceShape = (id: string, metadata: Record<string, string>, currency = 'brl'): Stripe.Price =>
  ({
    id,
    currency,
    metadata,
    active: true,
  }) as unknown as Stripe.Price;

describe('GET /api/premium/pricing', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('returns 200 with both cadences when flag on + both env vars present + Stripe returns valid metadata', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    const retrievePrice = vi.fn((priceId: string) => {
      if (priceId === 'price_monthly_test') {
        return Promise.resolve(
          priceShape('price_monthly_test', { baseAmountCents: '2990', devFeePercent: '10' }),
        );
      }
      return Promise.resolve(
        priceShape('price_annual_test', { baseAmountCents: '29900', devFeePercent: '10' }),
      );
    });
    stripe.retrievePrice = retrievePrice;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      monthly: {
        priceId: 'price_monthly_test',
        cadence: 'monthly',
        baseAmountCents: 2990,
        devFeePercent: 10,
        devFeeCents: 299,
        grossAmountCents: 3289,
        currency: 'BRL',
      },
      annual: {
        priceId: 'price_annual_test',
        cadence: 'annual',
        baseAmountCents: 29900,
        devFeePercent: 10,
        devFeeCents: 2990,
        grossAmountCents: 32890,
        currency: 'BRL',
      },
    });
    expect(retrievePrice).toHaveBeenCalledTimes(2);
  });

  it('responds identically with no auth header (route is unauthed)', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    stripe.retrievePrice = vi.fn((priceId: string) =>
      Promise.resolve(priceShape(priceId, { baseAmountCents: '2990', devFeePercent: '10' })),
    );

    const noAuthRes = await app.inject({ method: 'GET', url: '/api/premium/pricing' });
    const badAuthRes = await app.inject({
      method: 'GET',
      url: '/api/premium/pricing',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    // Both return 200 — no 401, no 403. Auth has no effect on this route.
    expect(noAuthRes.statusCode).toBe(200);
    expect(badAuthRes.statusCode).toBe(200);
  });

  it('returns 503 when feature flag disabled', async () => {
    const { app: builtApp } = await buildPricingApp({
      flagEnabled: false,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });

  it('returns 503 when STRIPE_PRICE_PREMIUM_GOLD_MONTHLY env is missing', async () => {
    const { app: builtApp } = await buildPricingApp({
      flagEnabled: true,
      monthly: undefined,
      annual: 'price_annual_test',
    });
    app = builtApp;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });

  it('returns 503 when STRIPE_PRICE_PREMIUM_GOLD_ANNUAL env is missing', async () => {
    const { app: builtApp } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: undefined,
    });
    app = builtApp;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
  });

  it('returns 500 when Stripe Price metadata.baseAmountCents is missing', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    stripe.retrievePrice = vi.fn((priceId: string) =>
      Promise.resolve(priceShape(priceId, { devFeePercent: '10' })),
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).error).toBe('PricingMetadataMissing');
  });

  it('returns 500 when Stripe Price metadata.devFeePercent is missing', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    stripe.retrievePrice = vi.fn((priceId: string) =>
      Promise.resolve(priceShape(priceId, { baseAmountCents: '2990' })),
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).error).toBe('PricingMetadataMissing');
  });

  it('returns 500 when Stripe Price metadata.baseAmountCents is non-numeric', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    stripe.retrievePrice = vi.fn((priceId: string) =>
      Promise.resolve(
        priceShape(priceId, { baseAmountCents: 'twenty-nine ninety', devFeePercent: '10' }),
      ),
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).error).toBe('PricingMetadataMissing');
  });

  it('upper-cases currency from Stripe (Stripe returns lowercase)', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    stripe.retrievePrice = vi.fn((priceId: string) =>
      Promise.resolve(priceShape(priceId, { baseAmountCents: '999', devFeePercent: '10' }, 'usd')),
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(200);
    const body = pricingOf(res);
    expect(body.monthly.currency).toBe('USD');
    expect(body.annual.currency).toBe('USD');
  });

  it('returns 503 when Stripe Price retrieval throws', async () => {
    const { app: builtApp, stripe } = await buildPricingApp({
      flagEnabled: true,
      monthly: 'price_monthly_test',
      annual: 'price_annual_test',
    });
    app = builtApp;
    stripe.retrievePrice = vi.fn(() =>
      Promise.reject(new Error('No such price: price_monthly_test')),
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });
});
