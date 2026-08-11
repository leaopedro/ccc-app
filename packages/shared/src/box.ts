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
});

export const boxViewPartnerItemSchema = z.object({
  partnerModuleId: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  subtotalCents: z.number().int(),
  nameSnapshot: z.string(),
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
  autoSendOptIn: z.boolean().optional(),
});
export type BoxConfirm = z.infer<typeof boxConfirmSchema>;
