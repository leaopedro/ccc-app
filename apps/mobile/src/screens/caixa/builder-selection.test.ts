import type { BoxCatalog } from '@ccc/shared/box';
import { describe, expect, it } from 'vitest';

import {
  buildPriceIndex,
  computeOptimisticTotals,
  filterByCategory,
  seedSelection,
  summaryState,
  toSelectionUpdate,
} from './builder-selection';

const box = {
  budgetCents: 45000,
  items: [
    { catalogItemId: 'a', quantity: 2, unitPriceCents: 10000 },
    { catalogItemId: 'gone', quantity: 1, unitPriceCents: 5000 },
  ],
  partnerItems: [{ partnerModuleId: 'p1', quantity: 1, unitPriceCents: 8000 }],
} as never;

const catalog = {
  categories: ['acessorios'],
  items: [
    {
      id: 'a',
      title: 'A',
      category: 'acessorios',
      priceCents: 12000,
      imageUrl: null,
      maxPerCycle: null,
      soldOut: false,
    },
    {
      id: 'b',
      title: 'B',
      category: 'oleo',
      priceCents: 20000,
      imageUrl: null,
      maxPerCycle: null,
      soldOut: false,
    },
  ],
  partners: [
    {
      id: 'pa',
      name: 'PA',
      logoUrl: null,
      description: null,
      modules: [{ id: 'p1', name: 'M', description: null, imageUrl: null, priceCents: 8000 }],
    },
  ],
} as unknown as BoxCatalog;

describe('seedSelection', () => {
  it('seeds item and partner qty maps from the box', () => {
    expect(seedSelection(box)).toEqual({
      items: { a: 2, gone: 1 },
      partners: { p1: 1 },
    });
  });
});

describe('buildPriceIndex', () => {
  it('prefers the box line snapshot, falls back to catalog price', () => {
    const idx = buildPriceIndex(box, catalog);
    // existing line 'a' keeps the snapshot 10000, not catalog 12000
    expect(idx.items.a).toBe(10000);
    // new item 'b' uses catalog price
    expect(idx.items.b).toBe(20000);
    expect(idx.partners.p1).toBe(8000);
  });
});

describe('computeOptimisticTotals', () => {
  it('computes overflow and charge (partners excluded from budget)', () => {
    const prices = { items: { a: 10000, b: 20000 }, partners: { p1: 8000 } };
    // items: a x5 = 50000 (budget 45000) -> overflow 5000; partner p1 x1 = 8000
    const t = computeOptimisticTotals({ a: 5 }, { p1: 1 }, prices, 45000);
    expect(t.itemsTotalCents).toBe(50000);
    expect(t.includedCents).toBe(45000);
    expect(t.overflowCents).toBe(5000);
    expect(t.partnersTotalCents).toBe(8000);
    expect(t.chargeCents).toBe(13000); // overflow + partners, sem frete
  });

  it('is zero-charge within budget', () => {
    const prices = { items: { a: 10000 }, partners: {} };
    const t = computeOptimisticTotals({ a: 3 }, {}, prices, 45000);
    expect(t.overflowCents).toBe(0);
    expect(t.chargeCents).toBe(0);
  });
});

describe('toSelectionUpdate', () => {
  it('keeps zero quantities so the diff-based API deletes removed lines', () => {
    // The API only deletes a saved line when it receives quantity: 0; an omitted
    // id is left unchanged. So a decrement-to-zero must be sent, not dropped.
    expect(toSelectionUpdate({ a: 2, b: 0 }, { p1: 1, p2: 0 })).toEqual({
      items: [
        { catalogItemId: 'a', quantity: 2 },
        { catalogItemId: 'b', quantity: 0 },
      ],
      partnerItems: [
        { partnerModuleId: 'p1', quantity: 1 },
        { partnerModuleId: 'p2', quantity: 0 },
      ],
    });
  });
});

describe('filterByCategory', () => {
  it('returns all when category is null, filters otherwise', () => {
    expect(filterByCategory(catalog.items, null)).toHaveLength(2);
    expect(filterByCategory(catalog.items, 'oleo').map((i: { id: string }) => i.id)).toEqual(['b']);
  });
});

describe('summaryState', () => {
  it('collapses when charge is zero', () => {
    expect(summaryState({ chargeCents: 0, catalogCount: 3 } as never).collapsed).toBe(true);
    expect(summaryState({ chargeCents: 100, catalogCount: 3 } as never).collapsed).toBe(false);
  });
});
