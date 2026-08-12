import { z } from 'zod';

const qty = z.number().int().min(0).max(1000);

export const boxStatusSchema = z.enum([
  'open',
  'awaiting_payment',
  'ready',
  'skipped',
  'cancelled',
]);
export type BoxStatus = z.infer<typeof boxStatusSchema>;

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
  cycleKey: z.string(),
  cutoffAt: z.string(),
  budgetCents: z.number().int(),
  currency: z.string(),
  itemsTotalCents: z.number().int(),
  partnersTotalCents: z.number().int(),
  overflowCents: z.number().int(),
  shippingCents: z.number().int(),
  chargeCents: z.number().int(),
  autoSendOptIn: z.boolean(),
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

export const boxCatalogItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  maxPerCycle: z.number().int().nullable(),
  soldOut: z.boolean(),
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
