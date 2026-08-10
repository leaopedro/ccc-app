import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { openMonthlyBoxIfEligible } from '../../src/services/box/open.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedPlanAndSettings = async () => {
  await prisma.boxSettings.upsert({
    where: { id: BOX_SETTINGS_SINGLETON_ID },
    update: { boxEnabled: true, cutoffDaysBeforeRenewal: 5 },
    create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, cutoffDaysBeforeRenewal: 5 },
  });
  await prisma.premiumPlan.upsert({
    where: { tier: 'gold' },
    update: { monthlyBoxBudgetCents: 15000 },
    create: {
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      monthlyBoxBudgetCents: 15000,
    },
  });
};

const makeMembership = async () => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_1',
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
};

describe('openMonthlyBoxIfEligible', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedPlanAndSettings();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('opens one box for an active membership on renewal', async () => {
    const m = await makeMembership();
    await openMonthlyBoxIfEligible(prisma, {
      kind: 'subscription.renewed',
      garageId: m.garageId,
      provider: 'stripe',
      providerSubRef: 'sub_1',
    } as never);
    const boxes = await prisma.monthlyBox.findMany({ where: { membershipId: m.id } });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.cycleKey).toBe('2026-08-01');
    expect(boxes[0]?.budgetCentsSnapshot).toBe(15000);
    expect(boxes[0]?.cutoffAt.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('is idempotent for the same cycle', async () => {
    const m = await makeMembership();
    const evt = {
      kind: 'subscription.renewed',
      garageId: m.garageId,
      provider: 'stripe',
      providerSubRef: 'sub_1',
    } as never;
    await openMonthlyBoxIfEligible(prisma, evt);
    await openMonthlyBoxIfEligible(prisma, evt);
    expect(await prisma.monthlyBox.count({ where: { membershipId: m.id } })).toBe(1);
  });

  it('does nothing for a non-open event kind', async () => {
    const m = await makeMembership();
    await openMonthlyBoxIfEligible(prisma, {
      kind: 'subscription.past_due',
      garageId: m.garageId,
      provider: 'stripe',
      providerSubRef: 'sub_1',
    } as never);
    expect(await prisma.monthlyBox.count({ where: { membershipId: m.id } })).toBe(0);
  });
});
