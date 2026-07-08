import {
  adminStoreProductDetailSchema,
  adminStoreProductPhotoSchema,
  adminStoreVariantSchema,
  type AdminStoreProductDetail,
  type AdminStoreProductPhoto,
  type AdminStoreVariant,
} from '@ccc/shared/admin';
import type {
  Product as DbProduct,
  ProductPhoto as DbProductPhoto,
  ProductType as DbProductType,
  Variant as DbVariant,
} from '@prisma/client';

import { displayPriceCents } from '../../../services/pricing/dev-fee.js';
import type { Uploads } from '../../../services/uploads/index.js';

export const serializeAdminVariant = (v: DbVariant, devFeePercent: number): AdminStoreVariant =>
  adminStoreVariantSchema.parse({
    id: v.id,
    productId: v.productId,
    name: v.name,
    sku: v.sku,
    priceCents: v.priceCents,
    displayPriceCents: displayPriceCents(v.priceCents, devFeePercent),
    devFeePercent,
    quantityTotal: v.quantityTotal,
    quantitySold: v.quantitySold,
    attributes: (v.attributes ?? {}) as Record<string, string>,
    active: v.active,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  });

export const serializeAdminPhoto = (p: DbProductPhoto, uploads: Uploads): AdminStoreProductPhoto =>
  adminStoreProductPhotoSchema.parse({
    id: p.id,
    objectKey: p.objectKey,
    url: uploads.buildPublicUrl(p.objectKey),
    sortOrder: p.sortOrder,
  });

export const serializeAdminProductDetail = (
  p: DbProduct & {
    variants: DbVariant[];
    photos: DbProductPhoto[];
    productType: Pick<DbProductType, 'name'>;
  },
  uploads: Uploads,
  devFeePercent: number,
): AdminStoreProductDetail =>
  adminStoreProductDetailSchema.parse({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    productTypeId: p.productTypeId,
    productTypeName: p.productType.name,
    basePriceCents: p.basePriceCents,
    currency: p.currency,
    status: p.status,
    virtual: p.virtual,
    visibleInStore: p.visibleInStore,
    allowPickup: p.allowPickup,
    allowShip: p.allowShip,
    shippingFeeCents: p.shippingFeeCents,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    variants: p.variants
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((v) => serializeAdminVariant(v, devFeePercent)),
    photos: p.photos
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((photo) => serializeAdminPhoto(photo, uploads)),
  });
