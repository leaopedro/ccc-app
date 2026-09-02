// packages/shared/src/premium.ts
// F8.09 — Stripe Checkout + Portal + duplicate-subscribe precheck schemas.
// F8.11 — premium status schema.

import { z } from 'zod';

/**
 * POST /api/me/premium/checkout — request body.
 * Client sends cadence; server resolves priceId server-side (never trusts
 * client-supplied Stripe price IDs). `planSlug` is optional and additive.
 * `addonKeys` are add-on module keys resolved against the catalog server-side —
 * the client never sends prices. Max 10 keeps the Checkout Session line-item
 * count bounded.
 */
export const premiumCheckoutRequestSchema = z.object({
  cadence: z.enum(['monthly', 'annual']),
  planSlug: z.string().min(1).max(40).optional(),
  addonKeys: z.array(z.string().min(1).max(40)).max(10).optional(),
});

export type PremiumCheckoutRequest = z.infer<typeof premiumCheckoutRequestSchema>;

/**
 * POST /api/me/premium/checkout — success response.
 */
export const premiumCheckoutResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string(),
});

export type PremiumCheckoutResponse = z.infer<typeof premiumCheckoutResponseSchema>;

/**
 * GET /api/me/premium/checkout-precheck — response.
 *
 * Three shapes, discriminated by `available` + `error` together (both `false`
 * branches share `available: false`, which is why this is a plain `z.union`
 * rather than a `z.discriminatedUnion('available', ...)` — the latter
 * requires the discriminant literal to be unique per branch):
 *   - available=true — no live membership, no in-flight attempt. See spec §5.
 *   - available=false, error=AlreadySubscribed — a live PremiumMembership
 *     already covers this garage (any provider).
 *   - available=false, error=SubscriptionAttemptInFlight — no live
 *     membership, but a native checkout-native call (Task 9) left a
 *     `pending` PremiumSubscriptionAttempt for this garage. No `provider`/
 *     `manageUrl`: there is no live subscription to manage yet, only an
 *     attempt that has not resolved. Reported the same way regardless of
 *     which package the pending attempt is for — this precheck has no
 *     client-supplied package to compare against (GET, no body), and the
 *     hosted checkout that consults this same shape inline cannot safely
 *     reuse a native attempt's subscription even when the package matches
 *     (unlike checkout-native's own same-package reuse, hosted checkout has
 *     no idempotency-key link back to that attempt), so blocking is
 *     unconditional either way.
 */
export const premiumCheckoutPrecheckResponseSchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    error: z.literal('AlreadySubscribed'),
    provider: z.enum(['stripe', 'apple_revenuecat']),
    manageUrl: z.string().url(),
  }),
  z.object({
    available: z.literal(false),
    error: z.literal('SubscriptionAttemptInFlight'),
  }),
]);

export type PremiumCheckoutPrecheckResponse = z.infer<typeof premiumCheckoutPrecheckResponseSchema>;

/**
 * POST /api/me/premium/billing-portal — response.
 */
export const premiumBillingPortalResponseSchema = z.object({
  url: z.string().url(),
});

export type PremiumBillingPortalResponse = z.infer<typeof premiumBillingPortalResponseSchema>;

/**
 * GET /api/me/premium/status — response. Spec §8.3.
 */
export const premiumStatusSchema = z.object({
  /** Whether the user currently holds an active premium entitlement. */
  active: z.boolean(),
  /** Current premium tier. null when no active entitlement. */
  tier: z.enum(['bronze', 'silver', 'gold']).nullable(),
  /**
   * Billing cadence of the live subscription row.
   * null for admin-granted premium (no cadence) or when inactive.
   */
  cadence: z.enum(['monthly', 'annual']).nullable(),
  /**
   * Provider that owns the live subscription.
   * null for admin-granted premium or when inactive.
   */
  provider: z.enum(['stripe', 'apple_revenuecat']).nullable(),
  /**
   * ISO-8601 datetime string for when the current paid period ends.
   * For admin-granted premium this is Garage.premiumUntil.
   * null when no entitlement OR perpetual admin grant.
   */
  currentPeriodEnd: z.string().datetime().nullable(),
  /**
   * True when the user has requested cancellation but the paid period has
   * not yet ended (status = 'cancel_scheduled'). Always false when inactive
   * or for admin-granted premium.
   */
  cancelAtPeriodEnd: z.boolean(),
  /**
   * URL for the user to manage their subscription.
   * Stripe: Billing Portal URL (freshly minted per-request).
   * Apple/RevenueCat: https://apps.apple.com/account/subscriptions
   * null for admin-granted premium (no self-serve management) or when inactive.
   */
  manageUrl: z.string().url().nullable(),
});

export type PremiumStatus = z.infer<typeof premiumStatusSchema>;

/**
 * GET /api/premium/pricing — single entry (one cadence).
 * Reflects the snapshot from Stripe.Price.metadata at request time:
 *   baseAmountCents — pre-devfee amount the user owes for the plan
 *   devFeePercent   — percent of baseAmountCents added on top as platform fee
 *   devFeeCents     — Math.round(baseAmountCents * devFeePercent / 100)
 *   grossAmountCents — baseAmountCents + devFeeCents (canon: Stripe gross formula)
 *
 * Canon §F8.1: devfee values are snapshotted from Stripe Price metadata, not
 * re-derived from env. Currency is the upper-cased ISO 4217 code from Stripe.
 */
export const premiumPricingEntrySchema = z.object({
  priceId: z.string().min(1),
  cadence: z.enum(['monthly', 'annual']),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().min(0).max(100),
  devFeeCents: z.number().int().nonnegative(),
  grossAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export type PremiumPricingEntry = z.infer<typeof premiumPricingEntrySchema>;

/**
 * GET /api/premium/pricing — full response.
 * Always returns both cadences (monthly + annual). If either Stripe Price
 * cannot be resolved, the route returns 503, NOT a partial response.
 */
export const premiumPricingResponseSchema = z.object({
  monthly: premiumPricingEntrySchema,
  annual: premiumPricingEntrySchema,
});

export type PremiumPricingResponse = z.infer<typeof premiumPricingResponseSchema>;

/**
 * Estados de membership que bloqueiam uma nova assinatura.
 *
 * Fonte unica. Antes disto a lista estava copiada em tres lugares
 * (me-premium.ts, me-premium-addons.ts e apply-membership-event.ts) e as tres
 * copias omitiam `trialing` e `paused`: um membro em trial ou com a cobranca
 * pausada abria uma segunda assinatura sem nada objetar.
 *
 * `expired` fica de fora de proposito. E o unico estado que libera recontratacao.
 */
export const LIVE_MEMBERSHIP_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancel_scheduled',
  'paused',
] as const;

export type LiveMembershipStatus = (typeof LIVE_MEMBERSHIP_STATUSES)[number];

export const isLiveMembershipStatus = (status: string): status is LiveMembershipStatus =>
  (LIVE_MEMBERSHIP_STATUSES as readonly string[]).includes(status);

/**
 * Os estados que o indice unico parcial do banco realmente cobre.
 *
 *   CREATE UNIQUE INDEX premium_membership_live_per_garage
 *     ON "PremiumMembership" ("garageId")
 *     WHERE status IN ('active', 'past_due', 'cancel_scheduled');
 *
 * (migracao 20260527094120, linhas 109-111.)
 *
 * NAO e a mesma lista de LIVE_MEMBERSHIP_STATUSES, e a diferenca e proposital.
 * LIVE_MEMBERSHIP_STATUSES responde "este membro tem direito / pode abrir outra
 * assinatura?" e por isso inclui `trialing` e `paused`. Esta lista responde
 * "o Postgres vai recusar este INSERT/UPDATE?", e o Postgres so recusa nos tres
 * estados acima. Uma linha `paused` ou `trialing` nao ocupa o slot do indice.
 *
 * Use esta constante, e so esta, em pre-checagens que existem para evitar um
 * P2002 nesse indice. Usar a lista larga ali recusaria ativacoes que o banco
 * teria aceitado: uma assinatura Stripe pausada bloquearia a compra Apple do
 * mesmo membro, cobrada e sem membership. Se um dia `trialing`/`paused` tambem
 * devem bloquear uma segunda membership, a mudanca e no indice, com migracao,
 * nao aqui.
 */
export const LIVE_PER_GARAGE_INDEX_STATUSES = [
  'active',
  'past_due',
  'cancel_scheduled',
] as const satisfies readonly LiveMembershipStatus[];

export type LivePerGarageIndexStatus = (typeof LIVE_PER_GARAGE_INDEX_STATUSES)[number];

/**
 * Rejeicoes de checkout premium que o cliente consegue tratar. Sao erros de
 * combinacao, nao de disponibilidade: repetir a mesma requisicao nunca
 * funciona, entao 503 e a resposta errada.
 */
export const PREMIUM_CHECKOUT_ERROR_CODES = ['ANNUAL_CADENCE_ADDON_UNSUPPORTED'] as const;

export type PremiumCheckoutErrorCode = (typeof PREMIUM_CHECKOUT_ERROR_CODES)[number];

export const premiumCheckoutRejectionSchema = z.object({
  error: z.literal('PremiumCheckoutRejected'),
  code: z.enum(PREMIUM_CHECKOUT_ERROR_CODES),
  message: z.string().min(1),
  addonKeys: z.array(z.string()),
});

export type PremiumCheckoutRejection = z.infer<typeof premiumCheckoutRejectionSchema>;

/**
 * POST /api/me/premium/checkout-native — resposta.
 *
 * clientSecret e obrigatorio: uma resposta 201 sem segredo daria ao app uma
 * folha de pagamento que nao pode cobrar nada.
 */
export const premiumNativeCheckoutResponseSchema = z.object({
  subscriptionId: z.string().min(1),
  clientSecret: z.string().min(1),
  attemptId: z.string().min(1),
});

export type PremiumNativeCheckoutResponse = z.infer<typeof premiumNativeCheckoutResponseSchema>;
