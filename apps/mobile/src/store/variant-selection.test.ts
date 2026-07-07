import type { StoreProductVariant } from '@jdm/shared/store';
import { describe, expect, it } from 'vitest';

import { resolveAddToCartVariantSelection } from './variant-selection';

const buildVariant = (overrides: Partial<StoreProductVariant>): StoreProductVariant => ({
  id: 'variant_1',
  sku: 'SKU-1',
  title: 'P',
  priceCents: 12000,
  displayPriceCents: 13200,
  devFeePercent: 10,
  compareAtPriceCents: null,
  currency: 'BRL',
  stockOnHand: 3,
  isActive: true,
  capacityDisplay: {
    status: 'available',
    mode: 'absolute',
    showAbsolute: true,
    showPercentage: false,
    remaining: 3,
    remainingPercent: null,
    thresholdPercent: 15,
  },
  ...overrides,
});

describe('resolveAddToCartVariantSelection', () => {
  it('returns sold_out when no active in-stock variants remain', () => {
    const result = resolveAddToCartVariantSelection([
      buildVariant({ stockOnHand: 0 }),
      buildVariant({ id: 'variant_2', isActive: false }),
    ]);

    expect(result).toEqual({ kind: 'sold_out' });
  });

  it('auto-selects the single purchasable variant', () => {
    const onlyVariant = buildVariant({ id: 'variant_only', title: '42' });

    const result = resolveAddToCartVariantSelection([
      buildVariant({ id: 'variant_0', stockOnHand: 0 }),
      onlyVariant,
    ]);

    expect(result).toEqual({
      kind: 'single',
      variant: onlyVariant,
    });
  });

  it('requires an explicit selection when multiple purchasable variants exist', () => {
    const small = buildVariant({ id: 'variant_s', title: 'P' });
    const medium = buildVariant({ id: 'variant_m', title: 'M' });

    const result = resolveAddToCartVariantSelection([small, medium]);

    expect(result).toEqual({
      kind: 'requires_selection',
      variants: [small, medium],
    });
  });
});
