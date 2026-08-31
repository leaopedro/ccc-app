/**
 * Task 6 — platform gate on the me-premium-addons WRITE routes.
 *
 * me-premium-addons.ts is a separate router from me-premium.ts. An
 * adversarial review found it was NOT covered by Task 5's gate: an iOS
 * client could attach a paid recurring add-on straight past the checkout
 * gate. This file closes that hole.
 *
 * Same classification rule as Task 5 (me-premium-platform-gate.test.ts):
 *   - POST /api/me/premium/addons (attach) STARTS a new paid commitment →
 *     gated.
 *   - DELETE /api/me/premium/addons/:addonKey (detach) REDUCES an existing
 *     commitment, same family as cancel/billing-portal → NOT gated.
 *   - GET /api/me/premium/subscription is a read of what the member already
 *     has → NOT gated.
 *
 * Pattern mirrors premium-addon-billing.test.ts (catalog + membership +
 * module seeding, FakeStripe injected through buildApp) and
 * me-premium-platform-gate.test.ts (asserting both directions: gated
 * platform refused, web platform allowed).
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

type AnyJson = Record<string, unknown>;
const json = (res: { json: () => unknown }): AnyJson => res.json() as AnyJson;

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const originalIos = process.env.PREMIUM_SUBSCRIPTIONS_IOS;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  if (originalIos === undefined) delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
  else process.env.PREMIUM_SUBSCRIPTIONS_IOS = originalIos;
};

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumAddonRedemption.deleteMany();
  await prisma.premiumAddonUsage.deleteMany();
  await prisma.premiumMembershipAddon.deleteMany();
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const garageOf = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

const buildAddonApp = async (): Promise<{ app: FastifyInstance; stripe: FakeStripe }> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
  const stripe = buildFakeStripe();
  const app = await buildApp(loadEnv(), { stripe });
  return { app, stripe };
};

const seedModule = (
  overrides: { key?: string; monthlyDeltaCents?: number; stripePriceId?: string | null } = {},
) =>
  prisma.premiumAddonModule.create({
    data: {
      key: overrides.key ?? 'wash',
      name: 'Lavagem',
      description: 'Descrição do módulo',
      monthlyDeltaCents: overrides.monthlyDeltaCents ?? 1990,
      currency: 'BRL',
      quotaPerCycle: 4,
      quotaUnit: 'access',
      active: true,
      sortOrder: 0,
      stripePriceId:
        overrides.stripePriceId === undefined ? 'price_addon_wash' : overrides.stripePriceId,
    },
  });

const seedMembership = (
  garageId: string,
  overrides: { provider?: 'stripe' | 'apple_revenuecat'; providerSubRef?: string } = {},
) => {
  const now = new Date();
  return prisma.premiumMembership.create({
    data: {
      garageId,
      provider: overrides.provider ?? 'stripe',
      providerCustomerRef: 'cus_test123',
      providerSubRef: overrides.providerSubRef ?? `sub_test_${garageId.slice(0, 6)}_${Date.now()}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600_000),
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 2990,
      currency: 'BRL',
    },
  });
};

describe('platform gate on POST /api/me/premium/addons', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    ({ app } = await buildAddonApp());
    env = loadEnv();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('refuses addon attach from a gated platform', async () => {
    const { user } = await createUser({ email: 'gated_attach@jdm.test', verified: true });
    const garage = await garageOf(user.id);
    await seedMembership(garage.id);
    await seedModule({ key: 'wash' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/addons',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { addonKey: 'wash' },
    });

    expect(res.statusCode).toBe(403);
    expect(json(res)).toMatchObject({ error: 'PlatformNotSupported' });
  });

  it('still allows the same call from web', async () => {
    const { user } = await createUser({ email: 'web_attach@jdm.test', verified: true });
    const garage = await garageOf(user.id);
    await seedMembership(garage.id);
    await seedModule({ key: 'wash' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/addons',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
      payload: { addonKey: 'wash' },
    });

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(201);
  });
});

describe('platform gate does NOT block DELETE /api/me/premium/addons/:addonKey', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    ({ app } = await buildAddonApp());
    env = loadEnv();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('a member detaching an already-attached addon is not refused on a gated platform', async () => {
    const { user } = await createUser({ email: 'gated_detach@jdm.test', verified: true });
    const garage = await garageOf(user.id);
    const membership = await seedMembership(garage.id);
    await seedModule({ key: 'wash' });
    await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: 'wash',
        status: 'active',
        monthlyDeltaCents: 1990,
        currency: 'BRL',
        quotaPerCycle: 4,
        quotaUnit: 'access',
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me/premium/addons/wash',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
    });

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(200);
  });
});

describe('platform gate does NOT block GET /api/me/premium/subscription', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    ({ app } = await buildAddonApp());
    env = loadEnv();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('a member reading their subscription is not refused on a gated platform', async () => {
    const { user } = await createUser({ email: 'gated_read@jdm.test', verified: true });
    const garage = await garageOf(user.id);
    await seedMembership(garage.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/subscription',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
    });

    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(200);
  });
});
