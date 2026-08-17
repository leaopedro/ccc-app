import { describe, expect, it } from 'vitest';

import {
  adminBoxAdvanceRequestSchema,
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemSchema,
  adminBoxMonthlyListResponseSchema,
  adminBoxPickingResponseSchema,
  adminBoxSettingsUpdateSchema,
  adminPartnerModuleCreateSchema,
  boxPickingRowSchema,
} from '../admin-box.js';

describe('admin-box catalog + partner schemas', () => {
  it('accepts a valid catalog item create', () => {
    const parsed = adminBoxCatalogItemCreateSchema.safeParse({
      slug: 'cafe-500g',
      title: 'Cafe 500g',
      description: 'Cafe especial',
      priceCents: 4500,
      category: 'bebidas',
      active: true,
      sortOrder: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects negative priceCents', () => {
    const parsed = adminBoxCatalogItemCreateSchema.safeParse({
      slug: 'x',
      title: 'X',
      description: 'x',
      priceCents: -1,
      category: 'c',
    });
    expect(parsed.success).toBe(false);
  });

  it('parses a full catalog item response', () => {
    const parsed = adminBoxCatalogItemSchema.parse({
      id: 'c1',
      slug: 'cafe',
      title: 'Cafe',
      description: 'd',
      priceCents: 4500,
      currency: 'BRL',
      category: 'bebidas',
      imageObjectKey: null,
      imageUrl: null,
      stockPerCycle: null,
      maxPerCycle: 3,
      active: true,
      sortOrder: 0,
      minTier: null,
      restrictedDisplay: 'locked',
    });
    expect(parsed.maxPerCycle).toBe(3);
  });

  it('accepts a valid partner module create', () => {
    const parsed = adminPartnerModuleCreateSchema.safeParse({
      name: 'Kit lavagem',
      priceCents: 9900,
      active: true,
      sortOrder: 0,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('admin-box settings schema', () => {
  it('accepts settings with cep ranges', () => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse({
      boxEnabled: true,
      cutoffDaysBeforeRenewal: 5,
      headerTitle: 'Sua caixa',
      freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
      shippingFeeCents: 1990,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a malformed cep', () => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse({
      freeShippingCepRanges: [{ from: 'abc', to: '83800-999' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects cutoff out of range', () => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse({ cutoffDaysBeforeRenewal: 40 });
    expect(parsed.success).toBe(false);
  });
});

describe('admin-box fulfillment schemas', () => {
  it('accepts a valid advance request and rejects unfulfilled/cancelled targets', () => {
    expect(adminBoxAdvanceRequestSchema.safeParse({ to: 'packed' }).success).toBe(true);
    expect(adminBoxAdvanceRequestSchema.safeParse({ to: 'unfulfilled' }).success).toBe(false);
    expect(adminBoxAdvanceRequestSchema.safeParse({ to: 'cancelled' }).success).toBe(false);
  });

  it('parses a full monthly list response', () => {
    const parsed = adminBoxMonthlyListResponseSchema.parse({
      cycleKey: '2026-08-01',
      availableCycles: ['2026-08-01', '2026-07-01'],
      counts: { unfulfilled: 1, packed: 0, shipped: 0, delivered: 0, cancelled: 0 },
      boxes: [
        {
          id: 'box_1',
          memberName: 'Fulano',
          memberEmail: 'fulano@jdm.test',
          status: 'ready',
          chargeCents: 0,
          currency: 'BRL',
          fulfillmentStatus: 'unfulfilled',
          orderStatus: null,
        },
      ],
    });
    expect(parsed.boxes[0]!.orderStatus).toBeNull();
    expect(parsed.counts.unfulfilled).toBe(1);
  });

  it('parses a picking response with item and partner rows', () => {
    const row = boxPickingRowSchema.parse({
      refId: 'ci_1',
      title: 'Adesivo',
      totalQuantity: 4,
      boxCount: 2,
    });
    expect(row.boxCount).toBe(2);
    const parsed = adminBoxPickingResponseSchema.parse({
      cycleKey: '2026-08-01',
      items: [row],
      partnerItems: [],
    });
    expect(parsed.items).toHaveLength(1);
  });
});

describe('adminBoxCatalogItemCreateSchema tier fields', () => {
  const base = {
    slug: 'adesivo',
    title: 'Adesivo',
    description: 'x',
    priceCents: 1000,
    category: 'acessorios',
  };
  it('accepts minTier + restrictedDisplay', () => {
    const r = adminBoxCatalogItemCreateSchema.parse({
      ...base,
      minTier: 'silver',
      restrictedDisplay: 'hidden',
    });
    expect(r.minTier).toBe('silver');
    expect(r.restrictedDisplay).toBe('hidden');
  });
  it('accepts null minTier and omitted display', () => {
    const r = adminBoxCatalogItemCreateSchema.parse({ ...base, minTier: null });
    expect(r.minTier).toBe(null);
  });
  it('rejects an unknown tier', () => {
    expect(() => adminBoxCatalogItemCreateSchema.parse({ ...base, minTier: 'platinum' })).toThrow();
  });
});
