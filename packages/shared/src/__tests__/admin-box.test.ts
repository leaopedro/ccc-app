import { describe, expect, it } from 'vitest';

import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemSchema,
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
