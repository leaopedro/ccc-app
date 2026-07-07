// apps/api/test/billing/me-premium-status.test.ts
import { prisma } from '@jdm/db';
import { premiumStatusSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('premiumStatusSchema shape', () => {
  it('accepts a fully-populated active Stripe response', () => {
    const valid = premiumStatusSchema.parse({
      active: true,
      tier: 'gold',
      cadence: 'monthly',
      provider: 'stripe',
      currentPeriodEnd: '2026-06-26T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      manageUrl: 'https://billing.stripe.com/session/abc123',
    });
    expect(valid.active).toBe(true);
    expect(valid.tier).toBe('gold');
    expect(valid.provider).toBe('stripe');
  });

  it('accepts a never-subscribed shape (all nullables null)', () => {
    const valid = premiumStatusSchema.parse({
      active: false,
      tier: null,
      cadence: null,
      provider: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      manageUrl: null,
    });
    expect(valid.active).toBe(false);
    expect(valid.tier).toBeNull();
  });

  it('rejects an unknown tier value', () => {
    expect(() =>
      premiumStatusSchema.parse({
        active: true,
        tier: 'bronze',
        cadence: 'monthly',
        provider: 'stripe',
        currentPeriodEnd: '2026-06-26T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        manageUrl: null,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const garageOf = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

/**
 * Insert a PremiumMembership row for the given garageId.
 * Mirrors the PremiumMembership model shape from spec §2.2.
 */
const seedMembership = async (
  garageId: string,
  overrides: {
    status?: string;
    provider?: string;
    cadence?: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date;
    currentPeriodStart?: Date;
  } = {},
) => {
  const now = new Date();
  const periodEnd = overrides.currentPeriodEnd ?? new Date(now.getTime() + 30 * 24 * 3600_000);
  return prisma.premiumMembership.create({
    data: {
      garageId,
      provider: (overrides.provider ?? 'stripe') as never,
      providerCustomerRef: 'cus_test123',
      providerSubRef: `sub_test_${garageId.slice(0, 6)}_${Date.now()}`,
      tier: 'gold' as never,
      cadence: (overrides.cadence ?? 'monthly') as never,
      status: (overrides.status ?? 'active') as never,
      currentPeriodStart: overrides.currentPeriodStart ?? now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 2990,
      currency: 'BRL',
    },
  });
};

// ---------------------------------------------------------------------------
// Endpoint integration tests
// ---------------------------------------------------------------------------

describe('GET /api/me/premium/status', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    const baseEnv = loadEnv();
    env = { ...baseEnv, GROWTH_PREMIUM_BILLING_ENABLED: true };
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp(env);
  });

  afterEach(async () => {
    await app.close();
  });

  const getStatus = (userId: string) =>
    app.inject({
      method: 'GET',
      url: '/api/me/premium/status',
      headers: { authorization: bearer(env, userId) },
    });

  it('never-subscribed user: active=false, all nullables null', async () => {
    const { user } = await createUser({ verified: true });
    const res = await getStatus(user.id);

    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(false);
    expect(body.tier).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.provider).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.manageUrl).toBeNull();
  });

  it('active Stripe subscription: manageUrl null when Stripe portal mint fails (test env)', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, { status: 'active', provider: 'stripe', cadence: 'monthly' });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.tier).toBe('gold');
    expect(body.cadence).toBe('monthly');
    expect(body.provider).toBe('stripe');
    expect(body.currentPeriodEnd).not.toBeNull();
    expect(body.cancelAtPeriodEnd).toBe(false);
    // In CI there's no live Stripe key; the SDK call to billingPortal.sessions.create
    // throws and the handler returns manageUrl=null (no fake placeholder).
    // A real production environment with valid STRIPE_SECRET_KEY would return a URL.
    expect(body.manageUrl).toBeNull();
  });

  it('active apple_revenuecat subscription: manageUrl is App Store subscriptions URL', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, {
      status: 'active',
      provider: 'apple_revenuecat',
      cadence: 'annual',
    });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.provider).toBe('apple_revenuecat');
    expect(body.cadence).toBe('annual');
    expect(body.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('past_due subscription: active=true, manageUrl null (Stripe call fails in CI)', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, { status: 'past_due', provider: 'stripe' });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.manageUrl).toBeNull();
  });

  it('cancel_scheduled: active=true, cancelAtPeriodEnd=true, manageUrl null (Stripe call fails in CI)', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, {
      status: 'cancel_scheduled',
      provider: 'stripe',
      cancelAtPeriodEnd: true,
    });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.cancelAtPeriodEnd).toBe(true);
    expect(body.manageUrl).toBeNull();
  });

  it('expired subscription: active=false, all nullables null', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const pastEnd = new Date(Date.now() - 7 * 24 * 3600_000);
    await seedMembership(g.id, {
      status: 'expired',
      provider: 'stripe',
      currentPeriodEnd: pastEnd,
      currentPeriodStart: new Date(pastEnd.getTime() - 30 * 24 * 3600_000),
    });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(false);
    expect(body.tier).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.provider).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.manageUrl).toBeNull();
  });

  it('admin-granted premium only (no PremiumMembership row): active=true, provider=null, cadence=null, manageUrl=null', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const until = new Date(Date.now() + 60 * 24 * 3600_000);
    // Simulate admin grant by setting Garage.premiumTier + Garage.premiumUntil directly.
    await prisma.garage.update({
      where: { id: g.id },
      data: { premiumTier: 'gold', premiumUntil: until },
    });
    // Confirm no PremiumMembership row exists for this garage.
    const count = await prisma.premiumMembership.count({ where: { garageId: g.id } });
    expect(count).toBe(0);

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.tier).toBe('gold');
    expect(body.provider).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.currentPeriodEnd).toBe(until.toISOString());
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.manageUrl).toBeNull();
  });

  it('perpetual admin grant (premiumUntil null): active=true, currentPeriodEnd null', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    // Perpetual admin grant: premiumTier set but premiumUntil left null
    // (canonical computeIsPremiumActive treats null as "no expiry").
    await prisma.garage.update({
      where: { id: g.id },
      data: { premiumTier: 'gold', premiumUntil: null },
    });
    const count = await prisma.premiumMembership.count({ where: { garageId: g.id } });
    expect(count).toBe(0);

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.tier).toBe('gold');
    expect(body.provider).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.manageUrl).toBeNull();
  });

  it('unauthenticated request: 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/premium/status' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/me/premium/status — feature flag disabled', () => {
  it('returns 503 when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
    await resetDatabase();
    const { buildApp } = await import('../../src/app.js');
    const baseEnv = loadEnv();
    const envOff = { ...baseEnv, GROWTH_PREMIUM_BILLING_ENABLED: false };
    const appOff = await buildApp(envOff);

    const { user } = await createUser({ verified: true });
    const res = await appOff.inject({
      method: 'GET',
      url: '/api/me/premium/status',
      headers: { authorization: bearer(baseEnv, user.id) },
    });
    expect(res.statusCode).toBe(503);
    await appOff.close();
  });
});

// Mark `makeApp` as referenced for the lint pass even though we use buildApp directly.
void makeApp;
