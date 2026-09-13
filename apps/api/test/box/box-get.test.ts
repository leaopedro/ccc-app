import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { boxViewSchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import { futureCutoff } from './cutoff.js';

const env = loadEnv();

const setupMemberWithBox = async () => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: futureCutoff(),
      budgetCentsSnapshot: 15000,
    },
  });
  return { user, box };
};

describe('GET /me/box', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/box' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a user without an eligible membership', async () => {
    const { user } = await createUser({ verified: true, email: 'nomember@jdm.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns the current-cycle box view', async () => {
    const { user } = await setupMemberWithBox();
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const view = boxViewSchema.parse(res.json());
    expect(view.budgetCents).toBe(15000);
    expect(view.status).toBe('open');
    expect(view.fulfillmentStatus).toBe('unfulfilled');
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Seed the box feature flag and the gold plan budget the backfill snapshots. */
const seedSettings = async (boxEnabled: boolean) => {
  await prisma.boxSettings.upsert({
    where: { id: BOX_SETTINGS_SINGLETON_ID },
    update: { boxEnabled, cutoffDaysBeforeRenewal: 5 },
    create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled, cutoffDaysBeforeRenewal: 5 },
  });
  await prisma.premiumPlan.upsert({
    where: { tier: 'gold' },
    update: { monthlyBoxBudgetCents: 15000 },
    create: { tier: 'gold', slug: 'gold', name: 'Gold', monthlyBoxBudgetCents: 15000 },
  });
};

/** An active member with a live period and NO MonthlyBox row for it. */
const setupMemberWithoutBox = async (periodEndInDays: number) => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 10 * DAY_MS),
      currentPeriodEnd: new Date(Date.now() + periodEndInDays * DAY_MS),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  return { user, membership };
};

describe('GET /me/box backfill', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const get = (userId: string) =>
    app.inject({ method: 'GET', url: '/me/box', headers: { authorization: bearer(env, userId) } });

  it('opens the current-cycle box for a member who subscribed before the box was enabled', async () => {
    await seedSettings(true);
    const { user, membership } = await setupMemberWithoutBox(20);

    const res = await get(user.id);

    expect(res.statusCode).toBe(200);
    const view = boxViewSchema.parse(res.json());
    expect(view.budgetCents).toBe(15000);
    expect(view.status).toBe('open');
    const boxes = await prisma.monthlyBox.findMany({ where: { membershipId: membership.id } });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.cycleKey).toBe(membership.currentPeriodStart.toISOString().slice(0, 10));
  });

  it('opens exactly one box across repeated reads', async () => {
    await seedSettings(true);
    const { user, membership } = await setupMemberWithoutBox(20);

    await get(user.id);
    await get(user.id);

    expect(await prisma.monthlyBox.count({ where: { membershipId: membership.id } })).toBe(1);
  });

  it('stays 404 while the box feature is disabled', async () => {
    await seedSettings(false);
    const { user, membership } = await setupMemberWithoutBox(20);

    const res = await get(user.id);

    expect(res.statusCode).toBe(404);
    expect(await prisma.monthlyBox.count({ where: { membershipId: membership.id } })).toBe(0);
  });

  // Past cutoff there is no time left to build the box, and the cutoff worker
  // would resolve a fresh one straight to `skipped` on its next tick.
  it('stays 404 when the cycle is already past its cutoff', async () => {
    await seedSettings(true);
    const { user, membership } = await setupMemberWithoutBox(1);

    const res = await get(user.id);

    expect(res.statusCode).toBe(404);
    expect(await prisma.monthlyBox.count({ where: { membershipId: membership.id } })).toBe(0);
  });
});
