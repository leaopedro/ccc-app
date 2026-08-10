import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runBoxCutoffTick } from '../../src/workers/box-cutoff.js';
import { createUser, resetDatabase } from '../helpers.js';

const pastCutoff = new Date('2026-08-01T00:00:00.000Z');

const makeBox = async (
  over: Partial<{
    status: string;
    autoSendOptIn: boolean;
    withItem: boolean;
    withAddress: boolean;
    budget: number;
  }>,
) => {
  const { user } = await createUser({
    verified: true,
    email: `u${Math.random().toString(36).slice(2, 7)}@jdm.test`,
  });
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
  let addressId: string | null = null;
  if (over.withAddress) {
    const a = await prisma.shippingAddress.create({
      data: {
        userId: user.id,
        recipientName: 'F',
        line1: 'R',
        number: '1',
        district: 'C',
        city: 'Curitiba',
        stateCode: 'PR',
        postalCode: '81000-000',
      },
    });
    addressId = a.id;
  }
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: pastCutoff,
      budgetCentsSnapshot: over.budget ?? 10000,
      status: (over.status ?? 'open') as never,
      autoSendOptIn: over.autoSendOptIn ?? false,
      shippingAddressId: addressId,
    },
  });
  if (over.withItem) {
    const item = await prisma.boxCatalogItem.create({
      data: {
        slug: `it${Math.random().toString(36).slice(2, 7)}`,
        title: 'Adesivo',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Adesivo',
      },
    });
  }
  return box;
};

describe('runBoxCutoffTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('skips an empty open box', async () => {
    const box = await makeBox({ status: 'open' });
    await runBoxCutoffTick({});
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.status).toBe('skipped');
  });

  it('skips an open box with items but no opt-in', async () => {
    const box = await makeBox({ status: 'open', withItem: true, autoSendOptIn: false });
    await runBoxCutoffTick({});
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.status).toBe('skipped');
  });

  it('auto-confirms an opted-in open box with an address to ready', async () => {
    const box = await makeBox({
      status: 'open',
      withItem: true,
      autoSendOptIn: true,
      withAddress: true,
    });
    await runBoxCutoffTick({});
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.status).toBe('ready');
    expect(fresh.chargeCents).toBe(0);
  });
});
