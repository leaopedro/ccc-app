import { z } from 'zod';

import { cartPaymentMethodSchema } from './cart.js';
import { capacityDisplayDescriptorSchema } from './general-settings.js';
import { ticketInputSchema } from './orders.js';
import { stateCodeSchema } from './profile.js';

export const storeProductStatusSchema = z.enum(['draft', 'active', 'archived']);
export type StoreProductStatus = z.infer<typeof storeProductStatusSchema>;

// Admin store queue covers physical fulfillment only. Virtual orders carry
// fulfillmentStatus='virtual_complete' at the DB level but they never surface
// in the admin store queue (kind='product' for virtual is filtered upstream by
// the singleton garage product type). Keep this narrow so SHIP/PICKUP
// transition tables remain exhaustive.
export const storeFulfillmentStatusSchema = z.enum([
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'pickup_ready',
  'picked_up',
  'cancelled',
]);
export type StoreFulfillmentStatus = z.infer<typeof storeFulfillmentStatusSchema>;

export const storeSortSchema = z.enum(['featured', 'newest', 'price_asc', 'price_desc']);
export type StoreSort = z.infer<typeof storeSortSchema>;

const booleanQueryParamSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return value;
}, z.boolean());

export const cepSchema = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, 'CEP inválido');
export type Cep = z.infer<typeof cepSchema>;

export const shippingAddressSchema = z.object({
  recipientName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(10).max(20),
  postalCode: cepSchema,
  street: z.string().trim().min(1).max(140),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(120).nullable().optional(),
  neighborhood: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  countryCode: z.literal('BR').default('BR'),
});
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;

export const shippingAddressInputSchema = shippingAddressSchema.extend({
  isDefault: z.boolean().optional(),
});
export type ShippingAddressInput = z.infer<typeof shippingAddressInputSchema>;

export const shippingAddressUpdateSchema = shippingAddressInputSchema.partial();
export type ShippingAddressUpdate = z.infer<typeof shippingAddressUpdateSchema>;

export const shippingAddressRecordSchema = shippingAddressSchema.extend({
  id: z.string().min(1),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ShippingAddressRecord = z.infer<typeof shippingAddressRecordSchema>;

export const shippingAddressListResponseSchema = z.object({
  items: z.array(shippingAddressRecordSchema),
});
export type ShippingAddressListResponse = z.infer<typeof shippingAddressListResponseSchema>;

export const storeCollectionSchema = z.object({
  id: z.string().min(1),
  slug: z.string().trim().min(1).max(140),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).nullable(),
  heroImageUrl: z.string().url().nullable(),
  sortOrder: z.number().int().nonnegative(),
  productCount: z.number().int().nonnegative(),
});
export type StoreCollection = z.infer<typeof storeCollectionSchema>;

export const storeProductTypeSchema = z.object({
  id: z.string().min(1),
  slug: z.string().trim().min(1).max(140),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable(),
});
export type StoreProductType = z.infer<typeof storeProductTypeSchema>;

export const storeProductImageSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  alt: z.string().trim().max(180).nullable(),
  sortOrder: z.number().int().nonnegative(),
});
export type StoreProductImage = z.infer<typeof storeProductImageSchema>;

export const storeProductVariantSchema = z.object({
  id: z.string().min(1),
  sku: z.string().trim().min(1).max(80).nullable(),
  title: z.string().trim().min(1).max(120),
  priceCents: z.number().int().nonnegative(),
  displayPriceCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  compareAtPriceCents: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3),
  stockOnHand: z.number().int().nonnegative(),
  isActive: z.boolean(),
  capacityDisplay: capacityDisplayDescriptorSchema,
});
export type StoreProductVariant = z.infer<typeof storeProductVariantSchema>;

export const storeProductSchema = z.object({
  id: z.string().min(1),
  slug: z.string().trim().min(1).max(140),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(10_000),
  shortDescription: z.string().trim().max(280).nullable(),
  status: storeProductStatusSchema,
  canShip: z.boolean(),
  canPickup: z.boolean(),
  coverImageUrl: z.string().url().nullable(),
  collectionIds: z.array(z.string().min(1)),
  productType: storeProductTypeSchema,
  variants: z.array(storeProductVariantSchema).min(1),
  images: z.array(storeProductImageSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoreProduct = z.infer<typeof storeProductSchema>;

export const storeProductSummarySchema = storeProductSchema
  .pick({
    id: true,
    slug: true,
    title: true,
    shortDescription: true,
    canShip: true,
    canPickup: true,
    coverImageUrl: true,
    productType: true,
  })
  .extend({
    priceRange: z.object({
      minPriceCents: z.number().int().nonnegative(),
      maxPriceCents: z.number().int().nonnegative(),
      minDisplayPriceCents: z.number().int().nonnegative(),
      maxDisplayPriceCents: z.number().int().nonnegative(),
      devFeePercent: z.number().int().nonnegative(),
      currency: z.string().length(3),
    }),
    inStock: z.boolean(),
  });
export type StoreProductSummary = z.infer<typeof storeProductSummarySchema>;

export const storeProductListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  collectionSlug: z.string().trim().min(1).max(140).optional(),
  productTypeSlug: z.string().trim().min(1).max(140).optional(),
  inStock: booleanQueryParamSchema.optional(),
  sort: storeSortSchema.default('featured'),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type StoreProductListQuery = z.infer<typeof storeProductListQuerySchema>;

export const storeCollectionListResponseSchema = z.object({
  items: z.array(storeCollectionSchema),
});
export type StoreCollectionListResponse = z.infer<typeof storeCollectionListResponseSchema>;

export const storeProductTypeListResponseSchema = z.object({
  items: z.array(storeProductTypeSchema),
});
export type StoreProductTypeListResponse = z.infer<typeof storeProductTypeListResponseSchema>;

export const storeProductListResponseSchema = z.object({
  items: z.array(storeProductSummarySchema),
  nextCursor: z.string().nullable(),
});
export type StoreProductListResponse = z.infer<typeof storeProductListResponseSchema>;

export const storeProductDetailResponseSchema = z.object({
  product: storeProductSchema,
  collections: z.array(storeCollectionSchema),
});
export type StoreProductDetailResponse = z.infer<typeof storeProductDetailResponseSchema>;

export const storeCartItemInputSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive().max(20),
});
export type StoreCartItemInput = z.infer<typeof storeCartItemInputSchema>;

export const mixedOrderRequestSchema = z
  .object({
    paymentMethod: cartPaymentMethodSchema,
    tickets: z.array(ticketInputSchema).default([]),
    storeItems: z.array(storeCartItemInputSchema).default([]),
    shippingAddress: shippingAddressSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tickets.length === 0 && value.storeItems.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pedido deve incluir ingressos ou produtos',
        path: ['storeItems'],
      });
    }

    if (value.storeItems.length > 0 && !value.shippingAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endereço de entrega é obrigatório para produtos físicos',
        path: ['shippingAddress'],
      });
    }
  });
export type MixedOrderRequest = z.infer<typeof mixedOrderRequestSchema>;

export const mixedOrderResponseSchema = z.object({
  checkoutId: z.string().min(1),
  status: z.enum(['pending', 'requires_action', 'paid', 'failed', 'expired']),
  provider: z.enum(['stripe', 'abacatepay']),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  ticketCount: z.number().int().nonnegative(),
  storeItemCount: z.number().int().nonnegative(),
  shippingAddress: shippingAddressSchema.nullable(),
});
export type MixedOrderResponse = z.infer<typeof mixedOrderResponseSchema>;

export const STORE_SETTINGS_SINGLETON_ID = 'store_default';

export const storeSettingsSchema = z.object({
  id: z.string().min(1),
  storeEnabled: z.boolean(),
  defaultShippingFeeCents: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  storeHeaderTitle: z.string().nullable(),
  storeHeaderSubtitle: z.string().nullable(),
  eventPickupEnabled: z.boolean(),
  pickupDisplayLabel: z.string().nullable(),
  supportPhone: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const storeSettingsUpdateSchema = z
  .object({
    storeEnabled: z.boolean().optional(),
    defaultShippingFeeCents: z.number().int().nonnegative().optional(),
    lowStockThreshold: z.number().int().nonnegative().optional(),
    storeHeaderTitle: z.string().trim().max(140).nullable().optional(),
    storeHeaderSubtitle: z.string().trim().max(240).nullable().optional(),
    eventPickupEnabled: z.boolean().optional(),
    pickupDisplayLabel: z.string().trim().max(140).nullable().optional(),
    supportPhone: z.string().trim().max(20).nullable().optional(),
  })
  .refine(
    (value) =>
      value.storeEnabled !== undefined ||
      value.defaultShippingFeeCents !== undefined ||
      value.lowStockThreshold !== undefined ||
      value.storeHeaderTitle !== undefined ||
      value.storeHeaderSubtitle !== undefined ||
      value.eventPickupEnabled !== undefined ||
      value.pickupDisplayLabel !== undefined ||
      value.supportPhone !== undefined,
    { message: 'envie ao menos um campo para atualizar' },
  );
export type StoreSettingsUpdate = z.infer<typeof storeSettingsUpdateSchema>;

export const adminStoreFulfillmentUpdateSchema = z
  .object({
    status: storeFulfillmentStatusSchema,
    trackingCode: z.string().trim().min(1).max(120).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'shipped' && !value.trackingCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trackingCode é obrigatório quando o pedido é enviado',
        path: ['trackingCode'],
      });
    }
  });
export type AdminStoreFulfillmentUpdate = z.infer<typeof adminStoreFulfillmentUpdateSchema>;
