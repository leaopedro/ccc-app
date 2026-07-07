import type { StoreProductVariant } from '@jdm/shared/store';

import { storeCopy } from '../../copy/store';

const MAX_PRODUCT_QUANTITY = 20;

export const isVariantSelectable = (variant: StoreProductVariant): boolean =>
  variant.isActive && variant.stockOnHand > 0;

export const getDefaultVariant = (
  variants: StoreProductVariant[],
  preferredVariantId?: string | null,
): StoreProductVariant | null => {
  if (preferredVariantId) {
    const preferred = variants.find((variant) => variant.id === preferredVariantId);
    if (preferred) return preferred;
  }

  return variants.find(isVariantSelectable) ?? variants[0] ?? null;
};

export const clampProductQuantity = (
  nextQuantity: number,
  variant: StoreProductVariant | null,
): number => {
  const stockLimit = variant ? Math.max(1, Math.min(MAX_PRODUCT_QUANTITY, variant.stockOnHand)) : 1;
  return Math.max(1, Math.min(nextQuantity, stockLimit));
};

export const getVariantStockLabel = (variant: StoreProductVariant): string | null => {
  const { capacityDisplay } = variant;

  if (capacityDisplay.status === 'unavailable' || !variant.isActive) {
    return storeCopy.stock.unavailable;
  }

  if (capacityDisplay.status === 'sold_out' || variant.stockOnHand <= 0) {
    return storeCopy.stock.soldOut;
  }

  if (capacityDisplay.showAbsolute && capacityDisplay.remaining != null) {
    return storeCopy.stock.remaining(capacityDisplay.remaining);
  }

  if (capacityDisplay.showPercentage && capacityDisplay.remainingPercent != null) {
    return storeCopy.stock.remainingPercent(capacityDisplay.remainingPercent);
  }

  return null;
};
