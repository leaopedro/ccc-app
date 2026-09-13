import { z } from 'zod';

import { garagePremiumTierSchema, type GaragePremiumTier } from './garage.js';

const qty = z.number().int().min(0).max(1000);

export const boxStatusSchema = z.enum([
  'open',
  'awaiting_payment',
  'ready',
  'skipped',
  'cancelled',
]);
export type BoxStatus = z.infer<typeof boxStatusSchema>;

export const boxFulfillmentStatusSchema = z.enum([
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
]);
export type BoxFulfillmentStatus = z.infer<typeof boxFulfillmentStatusSchema>;

export const boxViewItemSchema = z.object({
  catalogItemId: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  subtotalCents: z.number().int(),
  titleSnapshot: z.string(),
  imageUrl: z.string().nullable(),
  included: z.boolean(),
  dropReason: z.string().nullable(),
});

export const boxViewPartnerItemSchema = z.object({
  partnerModuleId: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  subtotalCents: z.number().int(),
  nameSnapshot: z.string(),
  imageUrl: z.string().nullable(),
  included: z.boolean(),
  dropReason: z.string().nullable(),
});

export const boxViewSchema = z.object({
  id: z.string(),
  status: boxStatusSchema,
  fulfillmentStatus: boxFulfillmentStatusSchema,
  cycleKey: z.string(),
  cutoffAt: z.string(),
  budgetCents: z.number().int(),
  currency: z.string(),
  itemsTotalCents: z.number().int(),
  partnersTotalCents: z.number().int(),
  overflowCents: z.number().int(),
  shippingCents: z.number().int(),
  chargeCents: z.number().int(),
  orderId: z.string().nullable(),
  autoSendOptIn: z.boolean(),
  shippingAddressId: z.string().nullable(),
  items: z.array(boxViewItemSchema),
  partnerItems: z.array(boxViewPartnerItemSchema),
});
export type BoxView = z.infer<typeof boxViewSchema>;

export const boxSelectionUpdateSchema = z.object({
  items: z.array(z.object({ catalogItemId: z.string().min(1), quantity: qty })).max(200),
  partnerItems: z.array(z.object({ partnerModuleId: z.string().min(1), quantity: qty })).max(200),
});
export type BoxSelectionUpdate = z.infer<typeof boxSelectionUpdateSchema>;

export const boxConfirmSchema = z.object({
  shippingAddressId: z.string().min(1),
});
export type BoxConfirm = z.infer<typeof boxConfirmSchema>;

export const boxCheckoutRequestSchema = z.object({
  method: z.enum(['pix', 'card']).default('pix'),
});
export type BoxCheckoutRequest = z.infer<typeof boxCheckoutRequestSchema>;

// Uniao discriminada por `method` porque a tela de pagamento renderiza coisas
// diferentes: QR + copia-e-cola no Pix, PaymentSheet no cartao. O cliente
// decide pelo `method` da RESPOSTA, nunca pelo que pediu — o metodo trava na
// primeira cobranca e um segundo checkout devolve o que ja existe.
//
// Consequencia de deploy: uma API antiga responde sem `method` e este schema
// lanca `invalid_union_discriminator`, quebrando a tela ate no Pix. A API tem
// de subir ANTES de qualquer build ou OTA que carregue este schema.
export const boxCheckoutResponseSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('pix'),
    brCode: z.string(),
    amountCents: z.number().int(),
    expiresAt: z.string(),
  }),
  z.object({
    method: z.literal('card'),
    clientSecret: z.string(),
    amountCents: z.number().int(),
    expiresAt: z.string(),
  }),
]);
export type BoxCheckoutResponse = z.infer<typeof boxCheckoutResponseSchema>;

export const boxCatalogItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  maxPerCycle: z.number().int().nullable(),
  soldOut: z.boolean(),
  locked: z.boolean(),
  minTier: garagePremiumTierSchema.nullable(),
});

export const boxCatalogModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
});

export const boxCatalogPartnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  description: z.string().nullable(),
  modules: z.array(boxCatalogModuleSchema),
});

export const boxCatalogSchema = z.object({
  categories: z.array(z.string()),
  items: z.array(boxCatalogItemSchema),
  partners: z.array(boxCatalogPartnerSchema),
});
export type BoxCatalog = z.infer<typeof boxCatalogSchema>;

export const boxHistoryEntrySchema = z.object({
  id: z.string(),
  cycleKey: z.string(),
  cycleStart: z.string(),
  status: boxStatusSchema,
  chargeCents: z.number().int(),
  thumbnails: z.array(z.string()),
  current: z.boolean(),
});
export const boxHistorySchema = z.array(boxHistoryEntrySchema);
export type BoxHistory = z.infer<typeof boxHistorySchema>;

export const boxPreferencesSchema = z.object({
  autoSendOptIn: z.boolean(),
  shippingAddressId: z.string().min(1).optional(),
});
export type BoxPreferences = z.infer<typeof boxPreferencesSchema>;

export const TIER_RANK: Record<GaragePremiumTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
};

/** true when userTier satisfies minTier. A null minTier is always satisfied. */
export const meetsMinTier = (
  userTier: GaragePremiumTier,
  minTier: GaragePremiumTier | null,
): boolean => minTier === null || TIER_RANK[userTier] >= TIER_RANK[minTier];
