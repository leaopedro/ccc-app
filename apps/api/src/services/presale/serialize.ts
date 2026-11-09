import { presaleProductSchema, type PresaleProduct } from '@ccc/shared/presale';

import type { Uploads } from '../uploads/index.js';

import type { PresaleProductRow } from './eligibility.js';

// Pre-sale has its own serializer, built from scratch against
// presaleProductSchema. It must never emit displayPriceCents or
// devFeePercent: the pre-sale charges the base price, with no dev fee, by
// deliberate decision — see the design doc's "Preço e taxa" section. Do not
// import anything from routes/store.ts: its serializers are private module
// `const`s, and storeProductVariantSchema requires the fee fields this
// schema deliberately omits.
export const serializePresaleProduct = (
  product: PresaleProductRow,
  uploads: Uploads,
): PresaleProduct => {
  const sortedPhotos = [...product.photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const cover = sortedPhotos[0] ? uploads.buildPublicUrl(sortedPhotos[0].objectKey) : null;

  return presaleProductSchema.parse({
    id: product.id,
    slug: product.slug,
    title: product.title,
    shortDescription: null,
    coverImageUrl: cover,
    canShip: product.allowShip,
    canPickup: product.allowPickup,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      title: variant.name,
      priceCents: variant.priceCents,
      currency: product.currency,
      stockOnHand: Math.max(0, variant.quantityTotal - variant.quantitySold),
      isActive: variant.active,
    })),
  });
};
