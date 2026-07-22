/**
 * Integration tests for P5 add-on billing (Stripe subscription items).
 *
 * Pattern combines premium-subscription.test.ts (catalog + membership seeding,
 * real Testcontainers Postgres) with me-premium.test.ts (FakeStripe injected
 * through buildApp so provider calls are asserted deterministically).
 *
 * Covers:
 *   - attach with a Stripe-backed membership + module.stripePriceId
 *     → addSubscriptionItem called + providerItemRef stored.
 *   - attach without module.stripePriceId → local-only, no provider call, no throw.
 *   - detach → removeSubscriptionItem called with the stored providerItemRef.
 *   - provider failure on attach does not corrupt local state.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
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

const seedModule = (overrides: { key?: string; monthlyDeltaCents?: number; stripePriceId?: string | null } = {}) =>
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
      stripePriceId: overrides.stripePriceId === undefined ? 'price_addon_wash' : overrides.stripePriceId,
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

describe('premium add-on billing (Stripe subscription items)', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    ({ app, stripe } = await buildAddonApp());
    env = loadEnv();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  const attach = (userId: string, addonKey: string) =>
    app.inject({
      method: 'POST',
      url: '/api/me/premium/addons',
      headers: { authorization: bearer(env, userId) },
      payload: { addonKey },
    });

  const detach = (userId: string, addonKey: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/me/premium/addons/${addonKey}`,
      headers: { authorization: bearer(env, userId) },
    });

  it('attach: stripe-backed membership + module.stripePriceId → addSubscriptionItem called + ref stored', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const membership = await seedMembership(g.id, { providerSubRef: 'sub_live_1' });
    await seedModule({ key: 'wash', stripePriceId: 'price_addon_wash' });

    const res = await attach(user.id, 'wash');
    expect(res.statusCode).toBe(201);

    const addCall = stripe.calls.find((c) => c.kind === 'addSubscriptionItem');
    expect(addCall).toBeDefined();
    const payload = addCall!.payload as { subscriptionId: string; priceId: string };
    expect(payload.subscriptionId).toBe('sub_live_1');
    expect(payload.priceId).toBe('price_addon_wash');

    const row = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { membershipId: membership.id, addonKey: 'wash' },
    });
    expect(row.providerItemRef).toBe('si_fake_1');
  });

  it('attach: module without stripePriceId → local-only, no provider call, no throw', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const membership = await seedMembership(g.id);
    await seedModule({ key: 'wash', stripePriceId: null });

    const res = await attach(user.id, 'wash');
    expect(res.statusCode).toBe(201);

    expect(stripe.calls.find((c) => c.kind === 'addSubscriptionItem')).toBeUndefined();
    const row = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { membershipId: membership.id, addonKey: 'wash' },
    });
    expect(row.providerItemRef).toBeNull();
  });

  it('attach: apple_revenuecat membership → local-only even when module has stripePriceId', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, { provider: 'apple_revenuecat' });
    await seedModule({ key: 'wash', stripePriceId: 'price_addon_wash' });

    const res = await attach(user.id, 'wash');
    expect(res.statusCode).toBe(201);
    expect(stripe.calls.find((c) => c.kind === 'addSubscriptionItem')).toBeUndefined();
  });

  it('detach: stripe item removed via removeSubscriptionItem with stored ref', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, { providerSubRef: 'sub_live_2' });
    await seedModule({ key: 'wash', stripePriceId: 'price_addon_wash' });

    expect((await attach(user.id, 'wash')).statusCode).toBe(201);

    const res = await detach(user.id, 'wash');
    expect(res.statusCode).toBe(200);

    const removeCall = stripe.calls.find((c) => c.kind === 'removeSubscriptionItem');
    expect(removeCall).toBeDefined();
    expect((removeCall!.payload as { subscriptionItemId: string }).subscriptionItemId).toBe(
      'si_fake_1',
    );
  });

  it('provider failure on attach does not corrupt local state', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const membership = await seedMembership(g.id, { providerSubRef: 'sub_live_3' });
    await seedModule({ key: 'wash', stripePriceId: 'price_addon_wash' });

    stripe.nextAddSubscriptionItemError = new Error('stripe: card_declined');

    const res = await attach(user.id, 'wash');
    expect(res.statusCode).toBe(500);

    // provider-first: no add-on row created, membership total untouched.
    const rows = await prisma.premiumMembershipAddon.findMany({
      where: { membershipId: membership.id },
    });
    expect(rows).toHaveLength(0);
    const after = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.addonsAmountCents).toBe(0);
  });
});
