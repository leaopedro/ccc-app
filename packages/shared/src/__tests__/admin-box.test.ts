import { describe, expect, it } from 'vitest';

import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemSchema,
  adminBoxSettingsUpdateSchema,
  adminPartnerModuleCreateSchema,
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
      stockPerCycle: null,
      maxPerCycle: 3,
      active: true,
      sortOrder: 0,
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
