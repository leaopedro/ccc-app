import type { StoreProductVariant } from '@jdm/shared/store';

export type AddToCartVariantSelection =
  | { kind: 'sold_out' }
  | { kind: 'single'; variant: StoreProductVariant }
  | { kind: 'requires_selection'; variants: StoreProductVariant[] };

const isPurchasableVariant = (variant: StoreProductVariant) =>
  variant.isActive && variant.stockOnHand > 0;

export function resolveAddToCartVariantSelection(
  variants: StoreProductVariant[],
): AddToCartVariantSelection {
  const purchasableVariants = variants.filter(isPurchasableVariant);

  if (purchasableVariants.length === 0) {
    return { kind: 'sold_out' };
  }

  if (purchasableVariants.length === 1) {
    const variant = purchasableVariants[0]!;
    return { kind: 'single', variant };
  }

  return { kind: 'requires_selection', variants: purchasableVariants };
}
