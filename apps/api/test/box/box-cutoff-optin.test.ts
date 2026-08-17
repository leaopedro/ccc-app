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

  it('drops a below-tier survivor and never reserves stock for it', async () => {
    const makeBronzeMemberBox = async () => {
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
          tier: 'bronze',
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
          budgetCentsSnapshot: 1_000_000,
          shippingCents: 0,
          status: 'open' as never,
          autoSendOptIn: true,
          shippingAddressId: address.id,
        },
      });
      return box;
    };

    // Box A: bronze member, single persisted included line for a gold-gated item.
    const goldItem = await prisma.boxCatalogItem.create({
      data: {
        slug: `gold${Math.random().toString(36).slice(2, 7)}`,
        title: 'Gold Only',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
        minTier: 'gold',
        stockPerCycle: 10,
      },
    });
    const gatedBox = await makeBronzeMemberBox();
    const goldLine = await prisma.monthlyBoxItem.create({
      data: {
        boxId: gatedBox.id,
        catalogItemId: goldItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Gold Only',
      },
    });

    // Box B (control): same bronze tier, single persisted included line for an ungated item.
    const openItem = await prisma.boxCatalogItem.create({
      data: {
        slug: `open${Math.random().toString(36).slice(2, 7)}`,
        title: 'Ungated',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
        stockPerCycle: 10,
      },
    });
    const controlBox = await makeBronzeMemberBox();
    const openLine = await prisma.monthlyBoxItem.create({
      data: {
        boxId: controlBox.id,
        catalogItemId: openItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Ungated',
      },
    });

    await runBoxCutoffTick({});

    const freshGoldLine = await prisma.monthlyBoxItem.findUniqueOrThrow({
      where: { id: goldLine.id },
    });
    expect(freshGoldLine.included).toBe(false);
    expect(freshGoldLine.dropReason).toBe('tier_restricted');

    const goldStock = await prisma.boxCatalogItemCycleStock.findUnique({
      where: {
        catalogItemId_cycleKey: { catalogItemId: goldItem.id, cycleKey: gatedBox.cycleKey },
      },
    });
    expect(goldStock?.reserved ?? 0).toBe(0);

    const freshGatedBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: gatedBox.id } });
    expect(freshGatedBox.status).toBe('skipped');

    // Control: ungated item survives and gets its stock reserved.
    const freshOpenLine = await prisma.monthlyBoxItem.findUniqueOrThrow({
      where: { id: openLine.id },
    });
    expect(freshOpenLine.included).toBe(true);

    const openStock = await prisma.boxCatalogItemCycleStock.findUniqueOrThrow({
      where: {
        catalogItemId_cycleKey: { catalogItemId: openItem.id, cycleKey: controlBox.cycleKey },
      },
    });
    expect(openStock.reserved).toBe(1);

    const freshControlBox = await prisma.monthlyBox.findUniqueOrThrow({
      where: { id: controlBox.id },
    });
    expect(freshControlBox.status).toBe('ready');
  });

  it('drops the tier-restricted line before the LIFO budget trim, sparing the newer eligible line', async () => {
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
        tier: 'bronze',
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
        budgetCentsSnapshot: 3000,
        shippingCents: 0,
        status: 'open' as never,
        autoSendOptIn: true,
        shippingAddressId: address.id,
      },
    });

    const goldItem = await prisma.boxCatalogItem.create({
      data: {
        slug: `gold${Math.random().toString(36).slice(2, 7)}`,
        title: 'Gold Only',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
        minTier: 'gold',
        stockPerCycle: 10,
      },
    });
    const openItem = await prisma.boxCatalogItem.create({
      data: {
        slug: `open${Math.random().toString(36).slice(2, 7)}`,
        title: 'Ungated',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
        stockPerCycle: 10,
      },
    });

    // Older, tier-restricted line: added first.
    const goldLine = await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: goldItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Gold Only',
        addedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    // Newer, eligible line: added later. Under a naive LIFO-first trim (no
    // tier drop beforehand) this line would be trimmed first, leaving the
    // gold line alone to be dropped by the reserve loop and the box empty.
    const openLine = await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: openItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Ungated',
        addedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    });

    await runBoxCutoffTick({});

    const freshOpenLine = await prisma.monthlyBoxItem.findUniqueOrThrow({
      where: { id: openLine.id },
    });
    expect(freshOpenLine.included).toBe(true);

    const openStock = await prisma.boxCatalogItemCycleStock.findUniqueOrThrow({
      where: {
        catalogItemId_cycleKey: { catalogItemId: openItem.id, cycleKey: box.cycleKey },
      },
    });
    expect(openStock.reserved).toBe(1);

    const freshGoldLine = await prisma.monthlyBoxItem.findUniqueOrThrow({
      where: { id: goldLine.id },
    });
    expect(freshGoldLine.included).toBe(false);
    expect(freshGoldLine.dropReason).toBe('tier_restricted');

    const freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(freshBox.status).toBe('ready');
  });
});
