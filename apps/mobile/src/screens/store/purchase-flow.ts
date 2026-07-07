import type { CartItemInput } from '@jdm/shared/cart';
import type { StoreProduct, StoreProductVariant } from '@jdm/shared/store';

import { clampProductQuantity, getDefaultVariant, isVariantSelectable } from './variant-selection';

type GridPurchaseResolution =
  | { type: 'direct_add'; product: StoreProduct; variant: StoreProductVariant }
  | { type: 'open_picker'; product: StoreProduct }
  | { type: 'unavailable'; product: StoreProduct };

type DetailPurchaseMode = 'add' | 'open_picker' | 'unavailable';

export const buildProductCartItemInput = (variantId: string, quantity: number): CartItemInput => ({
  source: 'purchase',
  kind: 'product',
  variantId,
  quantity,
  tickets: [],
  metadata: { source: 'mobile' },
});

export const getInitialVariantSelection = (product: StoreProduct): string | null => {
  if (product.variants.length !== 1) return null;
  return getDefaultVariant(product.variants)?.id ?? null;
};

export const getSelectedVariant = (
  product: StoreProduct,
  selectedVariantId: string | null,
): StoreProductVariant | null => {
  if (product.variants.length === 1) {
    return getDefaultVariant(product.variants, selectedVariantId);
  }

  if (!selectedVariantId) return null;
  return getDefaultVariant(product.variants, selectedVariantId);
};

export const getDetailPurchaseMode = (
  product: StoreProduct,
  selectedVariantId: string | null,
): DetailPurchaseMode => {
  const selectedVariant = getSelectedVariant(product, selectedVariantId);

  if (selectedVariant && isVariantSelectable(selectedVariant)) {
    return 'add';
  }

  if (product.variants.length > 1) {
    return 'open_picker';
  }

  return 'unavailable';
};

export const resolveGridPurchase = (product: StoreProduct): GridPurchaseResolution => {
  const defaultVariant = getDefaultVariant(product.variants);

  if (!defaultVariant || !isVariantSelectable(defaultVariant)) {
    return { type: 'unavailable', product };
  }

  if (product.variants.length === 1) {
    return { type: 'direct_add', product, variant: defaultVariant };
  }

  return { type: 'open_picker', product };
};

export const selectVariantForPurchase = (
  product: StoreProduct,
  variantId: string,
): string | null => {
  const variant = product.variants.find((item) => item.id === variantId) ?? null;
  return variant && isVariantSelectable(variant) ? variant.id : null;
};

export const getNextQuantity = (
  product: StoreProduct,
  selectedVariantId: string | null,
  nextQuantity: number,
): number =>
  clampProductQuantity(
    nextQuantity,
    getSelectedVariant(product, selectedVariantId) ??
      getDefaultVariant(product.variants, selectedVariantId),
  );
