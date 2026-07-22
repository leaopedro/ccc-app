/**
 * Integration tests for the member subscription + add-on surface:
 *   GET    /api/me/premium/subscription
 *   POST   /api/me/premium/addons
 *   DELETE /api/me/premium/addons/:addonKey
 *   POST   /admin/premium/addons/:membershipAddonId/redeem   (staff)
 *
 * Pattern mirrors premium-catalog.test.ts:
 *   - Testcontainers Postgres via the global setup (real DB, no mocks).
 *   - buildApp with GROWTH_PREMIUM_BILLING_ENABLED forced on.
 *   - resetDatabase() + a local resetCatalog() because the shared helper does
 *     not truncate the catalog / add-on tables.
 */

import { prisma } from '@ccc/db';
import {
  addonMutationResponseSchema,
  mySubscriptionResponseSchema,
  redeemAddonResponseSchema,
} from '@ccc/shared/premium-subscription';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

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

const seedGoldPlan = () =>
  prisma.premiumPlan.create({
    data: {
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      sortOrder: 0,
      prices: { create: [{ cadence: 'monthly', baseAmountCents: 2990, currency: 'BRL' }] },
      benefits: { create: [{ label: 'Benefício', sortOrder: 0 }] },
    },
  });

const seedModule = (
  overrides: Partial<{
    key: string;
    name: string;
    monthlyDeltaCents: number;
    quotaPerCycle: number;
    quotaUnit: 'access' | 'hours';
    active: boolean;
  }> = {},
) =>
  prisma.premiumAddonModule.create({
    data: {
      key: overrides.key ?? 'wash',
      name: overrides.name ?? 'Lavagem',
      description: 'Descrição do módulo',
      monthlyDeltaCents: overrides.monthlyDeltaCents ?? 1990,
      currency: 'BRL',
      quotaPerCycle: overrides.quotaPerCycle ?? 4,
      quotaUnit: overrides.quotaUnit ?? 'access',
      active: overrides.active ?? true,
      sortOrder: 0,
    },
  });

const seedMembership = (garageId: string, overrides: { status?: string } = {}) => {
  const now = new Date();
  return prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: 'cus_test123',
      providerSubRef: `sub_test_${garageId.slice(0, 6)}_${Date.now()}`,
      tier: 'gold',
      cadence: 'monthly',
      status: (overrides.status ?? 'active') as never,
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

describe('premium subscription + add-ons', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    env = { ...loadEnv(), GROWTH_PREMIUM_BILLING_ENABLED: true };
    app = await buildApp(env);
  });

  afterEach(async () => {
    await app.close();
  });

  const getSubscription = (userId: string) =>
    app.inject({
      method: 'GET',
      url: '/api/me/premium/subscription',
      headers: { authorization: bearer(env, userId) },
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

  // --- GET /subscription -----------------------------------------------------

  it('subscription read: no membership → active=false, empty add-ons', async () => {
    const { user } = await createUser({ verified: true });

    const res = await getSubscription(user.id);
    expect(res.statusCode).toBe(200);
    const body = mySubscriptionResponseSchema.parse(res.json());
    expect(body.active).toBe(false);
    expect(body.tier).toBeNull();
    expect(body.planSlug).toBeNull();
    expect(body.addons).toEqual([]);
    expect(body.totalAmountCents).toBe(0);
  });

  it('subscription read: live membership resolves plan + base amount', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedGoldPlan();
    await seedMembership(g.id);

    const res = await getSubscription(user.id);
    expect(res.statusCode).toBe(200);
    const body = mySubscriptionResponseSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.tier).toBe('gold');
    expect(body.planSlug).toBe('gold');
    expect(body.planName).toBe('Gold');
    expect(body.cadence).toBe('monthly');
    expect(body.baseAmountCents).toBe(2990);
    expect(body.addonsAmountCents).toBe(0);
    expect(body.totalAmountCents).toBe(2990);
    expect(body.addons).toEqual([]);
  });

  it('subscription read: attached add-on shows current-cycle usage', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedGoldPlan();
    await seedMembership(g.id);
    await seedModule({ key: 'wash', name: 'Lavagem', monthlyDeltaCents: 1990, quotaPerCycle: 4 });

    const attachRes = await attach(user.id, 'wash');
    expect(attachRes.statusCode).toBe(201);

    const res = await getSubscription(user.id);
    const body = mySubscriptionResponseSchema.parse(res.json());
    expect(body.addons).toHaveLength(1);
    const addon = body.addons[0]!;
    expect(addon.key).toBe('wash');
    expect(addon.name).toBe('Lavagem');
    expect(addon.status).toBe('active');
    expect(addon.quotaPerCycle).toBe(4);
    expect(addon.currentCycle).not.toBeNull();
    expect(addon.currentCycle?.quotaTotal).toBe(4);
    expect(addon.currentCycle?.quotaUsed).toBe(0);
    expect(addon.currentCycle?.quotaRemaining).toBe(4);
    expect(body.addonsAmountCents).toBe(1990);
    expect(body.totalAmountCents).toBe(2990 + 1990);
  });

  // --- POST /addons ----------------------------------------------------------

  it('attach happy path: creates add-on + usage cycle + recomputes total', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id);
    await seedModule({ key: 'wash', monthlyDeltaCents: 1990, quotaPerCycle: 4 });

    const res = await attach(user.id, 'wash');
    expect(res.statusCode).toBe(201);
    const body = addonMutationResponseSchema.parse(res.json());
    expect(body.addonKey).toBe('wash');
    expect(body.status).toBe('active');
    expect(body.addonsAmountCents).toBe(1990);
    expect(body.totalAmountCents).toBe(2990 + 1990);

    const membership = await prisma.premiumMembership.findFirstOrThrow({
      where: { garageId: g.id },
    });
    expect(membership.addonsAmountCents).toBe(1990);

    const row = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { membershipId: membership.id, addonKey: 'wash' },
      include: { usage: true },
    });
    expect(row.status).toBe('active');
    expect(row.providerItemRef).toBeNull();
    expect(row.usage).toHaveLength(1);
    expect(row.usage[0]!.quotaTotal).toBe(4);
  });

  it('attach duplicate: 409 AlreadyExists', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id);
    await seedModule({ key: 'wash' });

    expect((await attach(user.id, 'wash')).statusCode).toBe(201);
    const dup = await attach(user.id, 'wash');
    expect(dup.statusCode).toBe(409);
    expect(dup.json<{ error: string }>().error).toBe('AlreadyExists');
  });

  it('attach unknown key: 404 NotFound', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id);

    const res = await attach(user.id, 'does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('NotFound');
  });

  // --- DELETE /addons/:addonKey ----------------------------------------------

  it('detach: sets cancel_scheduled + recomputes addonsAmountCents to 0', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id);
    await seedModule({ key: 'wash', monthlyDeltaCents: 1990 });
    expect((await attach(user.id, 'wash')).statusCode).toBe(201);

    const res = await detach(user.id, 'wash');
    expect(res.statusCode).toBe(200);
    const body = addonMutationResponseSchema.parse(res.json());
    expect(body.status).toBe('cancel_scheduled');
    expect(body.addonsAmountCents).toBe(0);
    expect(body.totalAmountCents).toBe(2990);

    const membership = await prisma.premiumMembership.findFirstOrThrow({
      where: { garageId: g.id },
    });
    expect(membership.addonsAmountCents).toBe(0);
    const row = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { membershipId: membership.id, addonKey: 'wash' },
    });
    expect(row.status).toBe('cancel_scheduled');
  });

  it('detach: 404 when not attached', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id);

    const res = await detach(user.id, 'wash');
    expect(res.statusCode).toBe(404);
  });

  // --- POST /admin/premium/addons/:id/redeem ---------------------------------

  const redeem = (
    staffId: string,
    membershipAddonId: string,
    payload: { amount?: number; note?: string },
  ) =>
    app.inject({
      method: 'POST',
      url: `/admin/premium/addons/${membershipAddonId}/redeem`,
      headers: { authorization: bearer(env, staffId, 'organizer') },
      payload,
    });

  it('redeem happy path: decrements remaining + records redeemedByUserId', async () => {
    const { user } = await createUser({ verified: true });
    const { user: staff } = await createUser({ email: 'staff@jdm.test', role: 'organizer' });
    const g = await garageOf(user.id);
    await seedMembership(g.id);
    await seedModule({ key: 'wash', quotaPerCycle: 4 });
    expect((await attach(user.id, 'wash')).statusCode).toBe(201);

    const addonRow = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { addonKey: 'wash' },
    });

    const res = await redeem(staff.id, addonRow.id, { amount: 1, note: 'entrada' });
    expect(res.statusCode).toBe(200);
    const body = redeemAddonResponseSchema.parse(res.json());
    expect(body.quotaTotal).toBe(4);
    expect(body.quotaUsed).toBe(1);
    expect(body.quotaRemaining).toBe(3);

    const redemption = await prisma.premiumAddonRedemption.findFirstOrThrow({
      where: { amount: 1 },
    });
    expect(redemption.redeemedByUserId).toBe(staff.id);
    expect(redemption.note).toBe('entrada');
  });

  it('redeem over quota: 409 QuotaExceeded', async () => {
    const { user } = await createUser({ verified: true });
    const { user: staff } = await createUser({ email: 'staff@jdm.test', role: 'organizer' });
    const g = await garageOf(user.id);
    await seedMembership(g.id);
    await seedModule({ key: 'wash', quotaPerCycle: 4 });
    expect((await attach(user.id, 'wash')).statusCode).toBe(201);

    const addonRow = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { addonKey: 'wash' },
    });

    const res = await redeem(staff.id, addonRow.id, { amount: 5 });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('QuotaExceeded');
  });
});
