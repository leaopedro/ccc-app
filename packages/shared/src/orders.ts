import { z } from 'zod';

import { eventSummarySchema } from './events.js';

export const paymentMethodSchema = z.enum(['card', 'pix']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentProviderSchema = z.enum(['stripe', 'abacatepay']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const orderStatusSchema = z.enum([
  'pending',
  'paid',
  'failed',
  'refunded',
  'expired',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderKindSchema = z.enum(['ticket', 'extras_only', 'product', 'mixed']);
export type OrderKind = z.infer<typeof orderKindSchema>;

export const fulfillmentMethodSchema = z.enum(['ship', 'pickup', 'virtual']);
export type FulfillmentMethod = z.infer<typeof fulfillmentMethodSchema>;

export const fulfillmentStatusSchema = z.enum([
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'pickup_ready',
  'picked_up',
  'cancelled',
  'virtual_complete',
]);
export type FulfillmentStatus = z.infer<typeof fulfillmentStatusSchema>;

export const orderItemKindSchema = z.enum(['ticket', 'product', 'extras']);
export type OrderItemKind = z.infer<typeof orderItemKindSchema>;

// Brazilian plate: old style ABC-1234 or new Mercosul ABC1D23 (dash optional)
export const licensePlateSchema = z
  .string()
  .regex(/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/, 'invalid plate format');

export const ticketInputSchema = z.object({
  extras: z.array(z.string().min(1)).default([]),
  carId: z.string().min(1).optional(),
  licensePlate: licensePlateSchema.optional(),
  nickname: z.string().trim().min(1).max(60).optional(),
});
export type TicketInput = z.infer<typeof ticketInputSchema>;

export const createOrderRequestSchema = z.object({
  eventId: z.string().min(1),
  tierId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  method: paymentMethodSchema,
  extrasOnly: z.boolean().default(false),
  // Server enforces per-event maxTicketsPerUser (nullable = unlimited).
  // Request-size safety cap only; not a per-user business limit.
  tickets: z.array(ticketInputSchema).min(1).max(500),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

// clientSecret is returned only for card orders (Stripe). Pix uses a different shape in F4b.
// The mobile client reads its publishable key from EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
// not from this response, so it is intentionally omitted.
// Order responses carry the dev-fee snapshot so consumers render gross totals without
// re-deriving from the current env. `amountCents` keeps its existing meaning: charged gross
// total. `baseAmountCents + devFeeAmountCents + shippingCents == amountCents` for new orders.
export const orderFeeBreakdownSchema = z.object({
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
});
export type OrderFeeBreakdown = z.infer<typeof orderFeeBreakdownSchema>;

export const createOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  clientSecret: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

export const createPixOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  brCode: z.string().min(1),
  expiresAt: z.string().datetime(),
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type CreatePixOrderResponse = z.infer<typeof createPixOrderResponseSchema>;

const httpsUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), {
    message: 'URL must use https (or http://localhost for dev)',
  });

export const createWebCheckoutRequestSchema = createOrderRequestSchema.extend({
  successUrl: httpsUrlSchema,
  cancelUrl: httpsUrlSchema,
});
export type CreateWebCheckoutRequest = z.infer<typeof createWebCheckoutRequestSchema>;

export const createWebCheckoutResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  checkoutUrl: z.string().url(),
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type CreateWebCheckoutResponse = z.infer<typeof createWebCheckoutResponseSchema>;

export const getOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  provider: paymentProviderSchema,
  expiresAt: z.string().datetime().nullable(),
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  ticketId: z.string().min(1).optional(),
});
export type GetOrderResponse = z.infer<typeof getOrderResponseSchema>;

export const cancelMyOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  status: z.literal('cancelled'),
});
export type CancelMyOrderResponse = z.infer<typeof cancelMyOrderResponseSchema>;

export const myOrderLineItemSchema = z.object({
  id: z.string().min(1),
  kind: orderItemKindSchema,
  title: z.string().min(1),
  detail: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(),
  ticketIds: z.array(z.string().min(1)).optional(),
});
export type MyOrderLineItem = z.infer<typeof myOrderLineItemSchema>;

export const myOrderSchema = z.object({
  id: z.string().min(1),
  shortId: z.string().min(1),
  kind: orderKindSchema,
  status: orderStatusSchema,
  provider: paymentProviderSchema,
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  quantity: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  containsTickets: z.boolean(),
  containsStoreItems: z.boolean(),
  fulfillmentMethod: fulfillmentMethodSchema.nullable(),
  fulfillmentStatus: fulfillmentStatusSchema.nullable(),
  event: eventSummarySchema.nullable(),
  items: z.array(myOrderLineItemSchema),
  // Set on paid product/mixed pickup orders that are bound to an event ticket
  // owned by the requesting user. Mobile uses this to render a `Ver Voucher`
  // CTA that deep-links into the bound ticket detail. Null when not bound.
  pickupTicketId: z.string().min(1).nullable(),
});
export type MyOrder = z.infer<typeof myOrderSchema>;

export const myOrdersResponseSchema = z.object({
  items: z.array(myOrderSchema),
});
export type MyOrdersResponse = z.infer<typeof myOrdersResponseSchema>;

export const resumePixOrderResponseSchema = z.object({
  method: z.literal('pix'),
  orderId: z.string().min(1),
  brCode: z.string().min(1),
  expiresAt: z.string().datetime(),
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type ResumePixOrderResponse = z.infer<typeof resumePixOrderResponseSchema>;

export const resumeCardOrderResponseSchema = z.object({
  method: z.literal('card'),
  orderId: z.string().min(1),
  clientSecret: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().nonnegative(),
  devFeeAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type ResumeCardOrderResponse = z.infer<typeof resumeCardOrderResponseSchema>;

export const resumeOrderResponseSchema = z.discriminatedUnion('method', [
  resumePixOrderResponseSchema,
  resumeCardOrderResponseSchema,
]);
export type ResumeOrderResponse = z.infer<typeof resumeOrderResponseSchema>;
