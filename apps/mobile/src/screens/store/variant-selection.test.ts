import type { StoreProductVariant } from '@jdm/shared/store';
import { describe, expect, it } from 'vitest';

import {
  clampProductQuantity,
  getDefaultVariant,
  getVariantStockLabel,
  isVariantSelectable,
} from './variant-selection';

const variant = (overrides: Partial<StoreProductVariant> = {}): StoreProductVariant => ({
  id: 'var_1',
  sku: 'SKU-1',
  title: 'P',
  priceCents: 9900,
  displayPriceCents: 10890,
  devFeePercent: 10,
  compareAtPriceCents: null,
  currency: 'BRL',
  stockOnHand: 8,
  isActive: true,
  capacityDisplay: {
    status: 'available',
    mode: 'absolute',
    showAbsolute: true,
    showPercentage: false,
    remaining: 8,
    remainingPercent: null,
    thresholdPercent: 15,
  },
  ...overrides,
});

describe('store variant selection helpers', () => {
  it('prefers the explicitly requested variant when present', () => {
    const selected = getDefaultVariant([variant(), variant({ id: 'var_2', title: 'M' })], 'var_2');
    expect(selected?.id).toBe('var_2');
  });

  it('falls back to the first selectable variant', () => {
    const selected = getDefaultVariant([
      variant({ id: 'var_1', isActive: false }),
      variant({ id: 'var_2', stockOnHand: 0 }),
      variant({ id: 'var_3', stockOnHand: 4 }),
    ]);
    expect(selected?.id).toBe('var_3');
  });

  it('recognizes selectable variants', () => {
    expect(isVariantSelectable(variant())).toBe(true);
    expect(isVariantSelectable(variant({ stockOnHand: 0 }))).toBe(false);
    expect(isVariantSelectable(variant({ isActive: false }))).toBe(false);
  });

  it('clamps product quantity against stock and app limits', () => {
    expect(clampProductQuantity(0, variant({ stockOnHand: 3 }))).toBe(1);
    expect(clampProductQuantity(2, variant({ stockOnHand: 3 }))).toBe(2);
    expect(clampProductQuantity(8, variant({ stockOnHand: 3 }))).toBe(3);
    expect(clampProductQuantity(25, variant({ stockOnHand: 50 }))).toBe(20);
  });

  it('formats stock labels for the storefront detail screen from the capacity policy', () => {
    expect(getVariantStockLabel(variant({ isActive: false }))).toBe('Indisponível');
    expect(getVariantStockLabel(variant({ stockOnHand: 0 }))).toBe('Esgotado');
    expect(
      getVariantStockLabel(
        variant({
          stockOnHand: 12,
          capacityDisplay: {
            status: 'available',
            mode: 'absolute',
            showAbsolute: true,
            showPercentage: false,
            remaining: 12,
            remainingPercent: 100,
            thresholdPercent: 15,
          },
        }),
      ),
    ).toBe('12 restantes');
    expect(
      getVariantStockLabel(
        variant({
          stockOnHand: 1,
          capacityDisplay: {
            status: 'available',
            mode: 'percentage_threshold',
            showAbsolute: false,
            showPercentage: true,
            remaining: null,
            remainingPercent: 10,
            thresholdPercent: 15,
          },
        }),
      ),
    ).toBe('10% restantes');
    expect(
      getVariantStockLabel(
        variant({
          capacityDisplay: {
            status: 'available',
            mode: 'percentage_threshold',
            showAbsolute: false,
            showPercentage: false,
            remaining: null,
            remainingPercent: null,
            thresholdPercent: 15,
          },
        }),
      ),
    ).toBeNull();
    expect(
      getVariantStockLabel(
        variant({
          capacityDisplay: {
            status: 'available',
            mode: 'hidden',
            showAbsolute: false,
            showPercentage: false,
            remaining: null,
            remainingPercent: null,
            thresholdPercent: 15,
          },
        }),
      ),
    ).toBeNull();
  });
});
