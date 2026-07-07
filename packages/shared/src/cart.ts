import { z } from 'zod';

import { fulfillmentMethodSchema, licensePlateSchema } from './orders.js';
export type { FulfillmentMethod } from './orders.js';
export { fulfillmentMethodSchema } from './orders.js';

export const cartStatusSchema = z.enum(['open', 'checking_out', 'converted', 'abandoned']);
export type CartStatus = z.infer<typeof cartStatusSchema>;

export const cartItemKindSchema = z.enum(['ticket', 'extras_only', 'product']);
export type CartItemKind = z.infer<typeof cartItemKindSchema>;

export const cartItemSourceSchema = z.literal('purchase');
export type CartItemSource = z.infer<typeof cartItemSourceSchema>;

export const cartPaymentMethodSchema = z.enum(['card', 'pix']);
export type CartPaymentMethod = z.infer<typeof cartPaymentMethodSchema>;

export const cartItemTicketSchema = z.object({
  carId: z.string().min(1).optional(),
  licensePlate: licensePlateSchema.optional(),
  nickname: z.string().trim().min(1).max(60).optional(),
  extras: z.array(z.string().min(1)),
});
export type CartItemTicket = z.infer<typeof cartItemTicketSchema>;

export const cartItemTicketInputSchema = cartItemTicketSchema.extend({
  extras: z.array(z.string().min(1)).default([]),
});
export type CartItemTicketInput = z.infer<typeof cartItemTicketInputSchema>;

export const cartItemInputSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    tierId: z.string().min(1).optional(),
    variantId: z.string().min(1).optional(),
    source: cartItemSourceSchema.default('purchase'),
    kind: cartItemKindSchema.default('ticket'),
    quantity: z.number().int().positive().max(20).default(1),
    tickets: z.array(cartItemTicketInputSchema).default([]),
    metadata: z
      .object({
        source: z.enum(['mobile', 'admin']).default('mobile'),
        note: z.string().max(160).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'product') {
      if (!value.variantId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'variantId é obrigatório para itens de produto',
          path: ['variantId'],
        });
      }
      if (value.eventId || value.tierId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'itens de produto não devem informar eventId ou tierId',
          path: ['eventId'],
        });
      }
      if (value.tickets.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'itens de produto não usam tickets',
          path: ['tickets'],
        });
      }
    } else {
      if (!value.eventId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'eventId é obrigatório',
          path: ['eventId'],
        });
      }
      if (!value.tierId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tierId é obrigatório',
          path: ['tierId'],
        });
      }
      if (value.variantId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'variantId só é válido para itens de produto',
          path: ['variantId'],
        });
      }
      if (value.tickets.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tickets deve conter ao menos um item',
          path: ['tickets'],
        });
      }
    }
  });
export type CartItemInput = z.infer<typeof cartItemInputSchema>;

export const cartItemExtraSchema = z.object({
  extraId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(),
});
export type CartItemExtra = z.infer<typeof cartItemExtraSchema>;

export const cartStockWarningSchema = z.object({
  code: z.enum(['tier_low_stock', 'extra_low_stock', 'tier_sold_out', 'extra_sold_out']),
  itemId: z.string().min(1),
  extraId: z.string().min(1).optional(),
  message: z.string().min(1),
});
export type CartStockWarning = z.infer<typeof cartStockWarningSchema>;

export const staleCartDropReasonSchema = z.enum([
  'event_unpublished',
  'event_cancelled',
  'tier_removed',
  'extra_removed',
  'extra_sold_out',
  'variant_removed',
  'variant_inactive',
  'variant_sold_out',
]);
export type StaleCartDropReason = z.infer<typeof staleCartDropReasonSchema>;

export const evictedCartItemSchema = z.object({
  itemId: z.string().min(1),
  reason: staleCartDropReasonSchema,
  message: z.string().min(1),
});
export type EvictedCartItem = z.infer<typeof evictedCartItemSchema>;

export const cartTotalsSchema = z.object({
  ticketSubtotalCents: z.number().int().nonnegative(),
  extrasSubtotalCents: z.number().int().nonnegative(),
  productsSubtotalCents: z.number().int().nonnegative(),
  shippingSubtotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  // baseAmountCents is the sum of sellable line subtotals (no shipping, no fee).
  // devFeeAmountCents is applied to baseAmountCents at the configured devFeePercent.
  // amountCents stays gross charged total: base + devFee + shipping - discount.
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type CartTotals = z.infer<typeof cartTotalsSchema>;

export const cartItemProductSchema = z.object({
  productId: z.string().min(1),
  productTitle: z.string().min(1),
  productSlug: z.string().min(1),
  variantId: z.string().min(1),
  variantName: z.string().min(1),
  variantSku: z.string().min(1).nullable(),
  unitPriceCents: z.number().int().nonnegative(),
  canShip: z.boolean(),
  canPickup: z.boolean(),
  shippingFeeCents: z.number().int().nonnegative().nullable(),
  attributes: z.record(z.unknown()).nullable(),
});
export type CartItemProduct = z.infer<typeof cartItemProductSchema>;

export const cartItemSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1).nullable(),
  tierId: z.string().min(1).nullable(),
  variantId: z.string().min(1).nullable(),
  source: cartItemSourceSchema,
  kind: cartItemKindSchema,
  quantity: z.number().int().positive(),
  requiresCar: z.boolean(),
  tickets: z.array(cartItemTicketSchema),
  extras: z.array(cartItemExtraSchema),
  product: cartItemProductSchema.nullable(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  reservationExpiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  status: cartStatusSchema,
  items: z.array(cartItemSchema),
  totals: cartTotalsSchema,
  availableFulfillmentMethods: z.array(fulfillmentMethodSchema),
  version: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Cart = z.infer<typeof cartSchema>;

export const cartFeatureFlagsSchema = z.object({
  cartV1: z.boolean(),
});
export type CartFeatureFlags = z.infer<typeof cartFeatureFlagsSchema>;

export const getCartResponseSchema = z.object({
  cart: cartSchema.nullable(),
  stockWarnings: z.array(cartStockWarningSchema),
  evictedItems: z.array(evictedCartItemSchema),
  flags: cartFeatureFlagsSchema,
});
export type GetCartResponse = z.infer<typeof getCartResponseSchema>;

export const upsertCartItemRequestSchema = z.object({ item: cartItemInputSchema });
export type UpsertCartItemRequest = z.infer<typeof upsertCartItemRequestSchema>;

export const upsertCartItemResponseSchema = z.object({ cart: cartSchema });
export type UpsertCartItemResponse = z.infer<typeof upsertCartItemResponseSchema>;

export const removeCartItemParamsSchema = z.object({ itemId: z.string().min(1) });
export type RemoveCartItemParams = z.infer<typeof removeCartItemParamsSchema>;

export const clearCartResponseSchema = z.object({ ok: z.literal(true) });
export type ClearCartResponse = z.infer<typeof clearCartResponseSchema>;

export const beginCheckoutRequestSchema = z.object({
  paymentMethod: cartPaymentMethodSchema,
  fulfillmentMethod: fulfillmentMethodSchema.optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  shippingAddressId: z.string().min(1).optional(),
  pickupEventId: z.string().min(1).optional(),
});
export type BeginCheckoutRequest = z.infer<typeof beginCheckoutRequestSchema>;

export const beginCheckoutResponseSchema = z.object({
  checkoutId: z.string().min(1),
  status: z.enum(['pending', 'requires_action', 'succeeded']),
  cart: cartSchema,
  orderIds: z.array(z.string().min(1)),
  provider: z.enum(['stripe', 'abacatepay']),
  providerRef: z.string().min(1).nullable(),
  clientSecret: z.string().min(1).nullable(),
  checkoutUrl: z.string().url().nullable(),
  brCode: z.string().min(1).nullable(),
  reservationExpiresAt: z.string().datetime().nullable(),
});
export type BeginCheckoutResponse = z.infer<typeof beginCheckoutResponseSchema>;

export const checkoutStatusResponseSchema = z.object({
  checkoutId: z.string().min(1),
  status: z.enum(['pending', 'paid', 'failed', 'refunded', 'expired', 'cancelled']),
  orderIds: z.array(z.string().min(1)),
  provider: z.enum(['stripe', 'abacatepay']),
  providerRef: z.string().min(1).nullable(),
});
export type CheckoutStatusResponse = z.infer<typeof checkoutStatusResponseSchema>;
