import { z } from 'zod';

import { orderStatusSchema } from './orders.js';
import { stateCodeSchema } from './profile.js';
import { cepSchema } from './store.js';

// Items the montagem page can add to the box. Pickup at Pocket CASA or
// shipping within the area PresaleSettings covers. Distinct from
// `fulfillmentMethodSchema` in orders.ts, which also allows 'virtual'.
export const presaleFulfillmentMethodSchema = z.enum(['pickup', 'ship']);
export type PresaleFulfillmentMethod = z.infer<typeof presaleFulfillmentMethodSchema>;

export const PRESALE_MAX_QTY_PER_VARIANT = 20;

export const presaleCampaignSchema = z.object({
  enabled: z.boolean(),
  shippingFeeCents: z.number().int().nonnegative(),
  deliveryAreaLabel: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  pickupHours: z.string().nullable(),
  firstBatchLabel: z.string().nullable(),
});
export type PresaleCampaign = z.infer<typeof presaleCampaignSchema>;

// Public variant shape for the pre-sale. Deliberately does NOT extend
// storeProductVariantSchema: that schema requires displayPriceCents and
// devFeePercent, and the pre-sale charges priceCents with zero dev fee.
export const presaleVariantSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  stockOnHand: z.number().int().nonnegative(),
  isActive: z.boolean(),
});
export type PresaleVariant = z.infer<typeof presaleVariantSchema>;

export const presaleProductSchema = z.object({
  id: z.string().min(1),
  slug: z.string().trim().min(1).max(140),
  title: z.string().trim().min(1).max(140),
  shortDescription: z.string().trim().max(280).nullable(),
  coverImageUrl: z.string().url().nullable(),
  canShip: z.boolean(),
  canPickup: z.boolean(),
  variants: z.array(presaleVariantSchema).min(1),
});
export type PresaleProduct = z.infer<typeof presaleProductSchema>;

export const presaleProductListResponseSchema = z.object({
  items: z.array(presaleProductSchema),
});
export type PresaleProductListResponse = z.infer<typeof presaleProductListResponseSchema>;

const presaleItemInputSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(PRESALE_MAX_QTY_PER_VARIANT),
});

const presaleGuestInputSchema = z.object({
  name: z.string().trim().min(1).max(140),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(20).optional(),
});

const presaleDeliveryInputSchema = z.object({
  recipientName: z.string().trim().min(1).max(140),
  line1: z.string().trim().min(1).max(140),
  number: z.string().trim().min(1).max(20),
  district: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  postalCode: cepSchema,
});
export type PresaleDeliveryInput = z.infer<typeof presaleDeliveryInputSchema>;

export const presaleCheckoutRequestSchema = z
  .object({
    clientRequestId: z.string().trim().min(1).max(64),
    expectedTotalCents: z.number().int().nonnegative(),
    fulfillmentMethod: presaleFulfillmentMethodSchema,
    items: z.array(presaleItemInputSchema).min(1).max(50),
    guest: presaleGuestInputSchema,
    delivery: presaleDeliveryInputSchema.optional(),
    acceptedTermsVersion: z.string().min(1).max(40),
    acceptedPrivacyVersion: z.string().min(1).max(40),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillmentMethod === 'ship' && !value.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endereço de entrega é obrigatório para recebimento por entrega',
        path: ['delivery'],
      });
    }

    if (value.fulfillmentMethod === 'pickup' && value.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endereço de entrega não se aplica à retirada',
        path: ['delivery'],
      });
    }
  });
export type PresaleCheckoutRequest = z.infer<typeof presaleCheckoutRequestSchema>;

export const presaleCheckoutResponseSchema = z.object({
  orderId: z.string().min(1),
  token: z.string().min(1),
  checkoutUrl: z.string().url(),
  amountCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type PresaleCheckoutResponse = z.infer<typeof presaleCheckoutResponseSchema>;

export const presaleOrderStatusRequestSchema = z.object({
  orderId: z.string().min(1),
  token: z.string().min(1),
});
export type PresaleOrderStatusRequest = z.infer<typeof presaleOrderStatusRequestSchema>;

const presaleOrderItemSchema = z.object({
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(),
});
export type PresaleOrderItem = z.infer<typeof presaleOrderItemSchema>;

// The /obrigado page distinguishes four states, not three: pending (still
// processing), paid (confirmed), refunded (the favorited-link case an admin
// refund days later produces), and failed/expired/cancelled (try again).
export const presaleOrderStatusResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  fulfillmentMethod: presaleFulfillmentMethodSchema,
  amountCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  items: z.array(presaleOrderItemSchema),
  delivery: presaleDeliveryInputSchema.nullable(),
});
export type PresaleOrderStatusResponse = z.infer<typeof presaleOrderStatusResponseSchema>;
