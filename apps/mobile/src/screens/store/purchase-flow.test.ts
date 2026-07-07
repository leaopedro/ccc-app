import type { StoreProduct } from '@jdm/shared/store';
import { describe, expect, it } from 'vitest';

import {
  buildProductCartItemInput,
  getDetailPurchaseMode,
  getInitialVariantSelection,
  getNextQuantity,
  resolveGridPurchase,
  selectVariantForPurchase,
} from './purchase-flow';

const baseVariant: StoreProduct['variants'][number] = {
  id: 'var_1',
  sku: 'SKU-1',
  title: 'P',
  priceCents: 9900,
  displayPriceCents: 10890,
  devFeePercent: 10,
  compareAtPriceCents: null,
  currency: 'BRL',
  stockOnHand: 5,
  isActive: true,
  capacityDisplay: {
    status: 'available' as const,
    mode: 'absolute' as const,
    showAbsolute: true,
    showPercentage: false,
    remaining: 5,
    remainingPercent: null,
    thresholdPercent: 15,
  },
};

const buildProduct = (overrides: Partial<StoreProduct> = {}): StoreProduct => ({
  id: 'prod_1',
  slug: 'camiseta-jdm',
  title: 'Camiseta JDM',
  description: 'Malha pesada',
  shortDescription: 'Malha',
  status: 'active',
  canShip: true,
  canPickup: false,
  coverImageUrl: 'https://cdn.example.com/p1.jpg',
  collectionIds: ['col_1'],
  productType: {
    id: 'type_1',
    slug: 'vestuario',
    name: 'Vestuário',
    description: null,
  },
  variants: [baseVariant],
  images: [
    {
      id: 'img_1',
      url: 'https://cdn.example.com/p1.jpg',
      alt: null,
      sortOrder: 0,
    },
  ],
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-02T10:00:00.000Z',
  ...overrides,
});

describe('store purchase flow', () => {
  it('direct-adds only single-variant products from the grid entrypoint', () => {
    const resolution = resolveGridPurchase(buildProduct());

    expect(resolution.type).toBe('direct_add');
    if (resolution.type !== 'direct_add') return;
    expect(resolution.variant.id).toBe('var_1');
  });

  it('opens the picker for multi-variant products from the grid entrypoint', () => {
    const resolution = resolveGridPurchase(
      buildProduct({
        variants: [
          baseVariant,
          {
            ...baseVariant,
            id: 'var_2',
            sku: 'SKU-2',
            title: 'M',
          },
        ],
      }),
    );

    expect(resolution.type).toBe('open_picker');
  });

  it('keeps the detail CTA on the picker path before a multi-variant selection exists', () => {
    const mode = getDetailPurchaseMode(
      buildProduct({
        variants: [
          baseVariant,
          {
            ...baseVariant,
            id: 'var_2',
            sku: 'SKU-2',
            title: 'M',
          },
        ],
      }),
      null,
    );

    expect(mode).toBe('open_picker');
  });

  it('rejects sold-out or inactive variants in the picker flow', () => {
    const product = buildProduct({
      variants: [
        { ...baseVariant, id: 'var_1', stockOnHand: 0 },
        { ...baseVariant, id: 'var_2', isActive: false },
      ],
    });

    expect(selectVariantForPurchase(product, 'var_1')).toBeNull();
    expect(selectVariantForPurchase(product, 'var_2')).toBeNull();
  });

  it('builds the product cart payload with the purchase source required by cart', () => {
    expect(buildProductCartItemInput('var_1', 2)).toEqual({
      source: 'purchase',
      kind: 'product',
      variantId: 'var_1',
      quantity: 2,
      tickets: [],
      metadata: { source: 'mobile' },
    });
  });

  it('defaults and clamps picker quantity against the selected variant stock', () => {
    const product = buildProduct({
      variants: [{ ...baseVariant, stockOnHand: 3 }],
    });

    expect(getInitialVariantSelection(product)).toBe('var_1');
    expect(getNextQuantity(product, 'var_1', 5)).toBe(3);
  });

  it('lets the detail quantity move before multi-variant selection by clamping against the first selectable variant', () => {
    const product = buildProduct({
      variants: [
        { ...baseVariant, id: 'var_1', stockOnHand: 4 },
        { ...baseVariant, id: 'var_2', stockOnHand: 2, title: 'M' },
      ],
    });

    expect(getNextQuantity(product, null, 3)).toBe(3);
    expect(getNextQuantity(product, null, 8)).toBe(4);
  });
});
