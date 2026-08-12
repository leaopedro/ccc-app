import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runBoxCutoffTick } from '../../src/workers/box-cutoff.js';
import { createUser, resetDatabase } from '../helpers.js';

const pastCutoff = new Date('2026-08-01T00:00:00.000Z');

describe('box-cutoff autoSendOptIn Q10 gate', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('auto-sends the opted-in box and skips the non-opted-in box', async () => {
    const makeBoxWithItem = async (autoSendOptIn: boolean) => {
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
      const address = await prisma.shippingAddress.create({
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
      const box = await prisma.monthlyBox.create({
        data: {
          membershipId: membership.id,
          garageId: garage.id,
          cycleKey: '2026-08-01',
          cycleStart: membership.currentPeriodStart,
          cycleEnd: membership.currentPeriodEnd,
          cutoffAt: pastCutoff,
          budgetCentsSnapshot: 10000,
          status: 'open' as never,
          autoSendOptIn,
          shippingAddressId: address.id,
        },
      });
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
      return box;
    };

    const optInBox = await makeBoxWithItem(true);
    const noOptInBox = await makeBoxWithItem(false);

    await runBoxCutoffTick({});

    const freshOptIn = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: optInBox.id } });
    const freshNoOptIn = await prisma.monthlyBox.findUniqueOrThrow({
      where: { id: noOptInBox.id },
    });

    expect(freshOptIn.status).toBe('ready');
    expect(freshNoOptIn.status).toBe('skipped');
  });
});
