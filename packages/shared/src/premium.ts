// packages/shared/src/premium.ts
// F8.09 — Stripe Checkout + Portal + duplicate-subscribe precheck schemas.
// F8.11 — premium status schema.

import { z } from 'zod';

/**
 * POST /api/me/premium/checkout — request body.
 * Client sends cadence; server resolves priceId server-side (never trusts
 * client-supplied Stripe price IDs). `planSlug` is optional and additive: when
 * present the server resolves the plan tier from it and reads the matching
 * PremiumPlanPrice.stripePriceId from the catalog; when absent the server keeps
 * the legacy GOLD env-price behavior.
 */
export const premiumCheckoutRequestSchema = z.object({
  cadence: z.enum(['monthly', 'annual']),
  planSlug: z.string().min(1).max(40).optional(),
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
 * Two discriminants: available=true (no live membership) or available=false
 * (AlreadySubscribed). See spec §5.
 */
export const premiumCheckoutPrecheckResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    error: z.literal('AlreadySubscribed'),
    provider: z.enum(['stripe', 'apple_revenuecat']),
    manageUrl: z.string().url(),
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
  /** Current premium tier. Gold-only v1; null when no active entitlement. */
  tier: z.enum(['gold']).nullable(),
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
