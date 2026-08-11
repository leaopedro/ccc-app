import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { releaseCycleStock, reserveCycleStock } from '../../../src/services/box/stock.js';
import { resetDatabase } from '../../helpers.js';

const cycleKey = '2026-08-01';

const makeItem = async (stockPerCycle: number | null) =>
  prisma.boxCatalogItem.create({
    data: {
      slug: `item-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Item',
      description: 'x',
      priceCents: 1000,
      category: 'sticker',
      stockPerCycle,
    },
  });

describe('cycle stock reservation', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reserves up to capacity then reports sold out', async () => {
    const item = await makeItem(3);
    const args = { catalogItemId: item.id, cycleKey, capacity: 3, quantity: 2 };
    expect(await prisma.$transaction((tx) => reserveCycleStock(tx, args))).toBe(true);
    expect(await prisma.$transaction((tx) => reserveCycleStock(tx, args))).toBe(false);
    const row = await prisma.boxCatalogItemCycleStock.findUnique({
      where: { catalogItemId_cycleKey: { catalogItemId: item.id, cycleKey } },
    });
    expect(row?.reserved).toBe(2);
  });

  it('treats null capacity as unlimited without a ledger row', async () => {
    const item = await makeItem(null);
    const ok = await prisma.$transaction((tx) =>
      reserveCycleStock(tx, { catalogItemId: item.id, cycleKey, capacity: null, quantity: 5 }),
    );
    expect(ok).toBe(true);
    const rows = await prisma.boxCatalogItemCycleStock.findMany({
      where: { catalogItemId: item.id },
    });
    expect(rows).toHaveLength(0);
  });

  it('release returns reserved units', async () => {
    const item = await makeItem(3);
    await prisma.$transaction((tx) =>
      reserveCycleStock(tx, { catalogItemId: item.id, cycleKey, capacity: 3, quantity: 2 }),
    );
    await prisma.$transaction((tx) =>
      releaseCycleStock(tx, { catalogItemId: item.id, cycleKey, quantity: 1 }),
    );
    const row = await prisma.boxCatalogItemCycleStock.findUnique({
      where: { catalogItemId_cycleKey: { catalogItemId: item.id, cycleKey } },
    });
    expect(row?.reserved).toBe(1);
  });
});
