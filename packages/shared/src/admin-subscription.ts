import { z } from 'zod';

/**
 * Admin subscription control surface.
 *
 * Admin-only, portanto pode carregar dado financeiro interno que o schema
 * publico nao expoe (repasse, margem). Nao carrega referencia de provider:
 * providerCustomerRef, providerSubRef e providerItemRef ficam de fora
 * deliberadamente — o admin nao precisa deles para operar e expor id de
 * provider amplia a superficie sem ganho.
 */

const tierSchema = z.enum(['bronze', 'silver', 'gold']);
const cadenceSchema = z.enum(['monthly', 'annual']);
const providerSchema = z.enum(['stripe', 'apple_revenuecat']);
const membershipStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancel_scheduled',
  'expired',
  'paused',
]);
const addonStatusSchema = z.enum(['active', 'cancel_scheduled', 'cancelled']);
const quotaUnitSchema = z.enum(['access', 'hours']);

export const adminSubscriptionAddonCycleSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  quotaTotal: z.number().int().nonnegative(),
  quotaUsed: z.number().int().nonnegative(),
  quotaRemaining: z.number().int(),
});
export type AdminSubscriptionAddonCycle = z.infer<typeof adminSubscriptionAddonCycleSchema>;

export const adminSubscriptionAddonSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  vendorName: z.string().nullable(),
  status: addonStatusSchema,
  quotaUnit: quotaUnitSchema,
  quotaPerCycle: z.number().int().nonnegative(),
  /** Valor cobrado do membro por ciclo. */
  monthlyDeltaCents: z.number().int().nonnegative(),
  /** Valor repassado ao fornecedor por ciclo. */
  payoutAmountCents: z.number().int().nonnegative(),
  /** Derivado: monthlyDeltaCents - payoutAmountCents. Pode ser negativo. */
  marginCents: z.number().int(),
  /**
   * Derivado de providerItemRef !== null. Falso significa que a Stripe NAO esta
   * cobrando por este modulo, apesar de ele aparecer no valor total local.
   */
  billingIntegrated: z.boolean(),
  currentCycle: adminSubscriptionAddonCycleSchema.nullable(),
});
export type AdminSubscriptionAddon = z.infer<typeof adminSubscriptionAddonSchema>;

export const adminSubscriptionInvoiceSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  paidAt: z.string().datetime(),
  grossAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  refundedAt: z.string().datetime().nullable(),
  refundedAmountCents: z.number().int().nullable(),
});
export type AdminSubscriptionInvoice = z.infer<typeof adminSubscriptionInvoiceSchema>;

export const adminSubscriptionDetailSchema = z.object({
  membershipId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string(),
  userEmail: z.string(),
  garageId: z.string().min(1),
  garageSlug: z.string(),
  tier: tierSchema,
  planSlug: z.string().nullable(),
  planName: z.string().nullable(),
  cadence: cadenceSchema,
  status: membershipStatusSchema,
  provider: providerSchema,
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: z.string().datetime().nullable(),
  baseAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  paymentBrand: z.string().nullable(),
  paymentLast4: z.string().nullable(),
  /** provider === 'stripe'. Falso desabilita toda acao na interface. */
  mutable: z.boolean(),
  addons: z.array(adminSubscriptionAddonSchema),
  invoices: z.array(adminSubscriptionInvoiceSchema),
});
export type AdminSubscriptionDetail = z.infer<typeof adminSubscriptionDetailSchema>;

export const adminSubscriptionChangePlanSchema = z.object({
  tier: tierSchema,
  cadence: cadenceSchema,
});
export type AdminSubscriptionChangePlan = z.infer<typeof adminSubscriptionChangePlanSchema>;

export const adminSubscriptionAddonAttachSchema = z.object({
  addonKey: z.string().min(1).max(40),
});
export type AdminSubscriptionAddonAttach = z.infer<typeof adminSubscriptionAddonAttachSchema>;

/**
 * Resposta das acoes que so chamam a Stripe. pending e literal true: o banco
 * ainda nao mudou, quem escreve e o webhook. A interface usa isso para nao
 * mostrar o valor novo antes da confirmacao.
 */
export const adminSubscriptionActionResponseSchema = z.object({
  ok: z.literal(true),
  pending: z.literal(true),
});
export type AdminSubscriptionActionResponse = z.infer<typeof adminSubscriptionActionResponseSchema>;

/**
 * Resposta das mutacoes de modulo. pending e literal false: attach e detach
 * gravam no banco na hora, depois da chamada a Stripe, igual ao fluxo do membro.
 */
export const adminSubscriptionAddonMutationResponseSchema = z.object({
  ok: z.literal(true),
  pending: z.literal(false),
  addonKey: z.string().min(1),
  status: addonStatusSchema,
  addonsAmountCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
});
export type AdminSubscriptionAddonMutationResponse = z.infer<
  typeof adminSubscriptionAddonMutationResponseSchema
>;
