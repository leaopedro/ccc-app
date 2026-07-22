// packages/shared/src/premium-subscription.ts
// Premium subscription — member "my subscription" read + add-on attach/detach +
// staff redeem request/response schemas.
//
// Client-facing ONLY: provider ids (stripePriceId/rcProductId/providerItemRef)
// live on DB rows but are NEVER serialized here. Real provider billing (Stripe
// subscription items) lands in a later phase; these shapes are provider-neutral.

import { z } from 'zod';

/** Per-cycle usage snapshot for an attached add-on. null when no open cycle. */
export const mySubscriptionAddonCycleSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  quotaTotal: z.number().int().nonnegative(),
  quotaUsed: z.number().int().nonnegative(),
  quotaRemaining: z.number().int(),
});

export type MySubscriptionAddonCycle = z.infer<typeof mySubscriptionAddonCycleSchema>;

/** A single add-on attached to the member's live membership. */
export const mySubscriptionAddonSchema = z.object({
  key: z.string(),
  name: z.string(),
  status: z.enum(['active', 'cancel_scheduled', 'cancelled']),
  quotaUnit: z.enum(['access', 'hours']),
  quotaPerCycle: z.number().int(),
  currentCycle: mySubscriptionAddonCycleSchema.nullable(),
});

export type MySubscriptionAddon = z.infer<typeof mySubscriptionAddonSchema>;

/**
 * GET /api/me/premium/subscription — current membership resolved to its plan.
 * When there is no live membership: active=false, plan fields null, amounts 0,
 * addons empty.
 */
export const mySubscriptionResponseSchema = z.object({
  active: z.boolean(),
  tier: z.enum(['bronze', 'silver', 'gold']).nullable(),
  planSlug: z.string().nullable(),
  planName: z.string().nullable(),
  cadence: z.enum(['monthly', 'annual']).nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  baseAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  addons: z.array(mySubscriptionAddonSchema),
});

export type MySubscriptionResponse = z.infer<typeof mySubscriptionResponseSchema>;

/** POST /api/me/premium/addons — attach an add-on module by key. */
export const attachAddonRequestSchema = z.object({
  addonKey: z.string().min(1),
});

export type AttachAddonRequest = z.infer<typeof attachAddonRequestSchema>;

/**
 * POST /api/me/premium/addons + DELETE /api/me/premium/addons/:addonKey —
 * reflects the add-on's resulting status + the recomputed recurring totals.
 */
export const addonMutationResponseSchema = z.object({
  addonKey: z.string(),
  status: z.enum(['active', 'cancel_scheduled', 'cancelled']),
  addonsAmountCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
});

export type AddonMutationResponse = z.infer<typeof addonMutationResponseSchema>;

/** POST /api/admin/premium/addons/:membershipAddonId/redeem — request body. */
export const redeemAddonRequestSchema = z.object({
  amount: z.number().int().min(1).default(1),
  note: z.string().max(240).optional(),
});

export type RedeemAddonRequest = z.infer<typeof redeemAddonRequestSchema>;

/** Redeem — updated current-cycle quota after the redemption. */
export const redeemAddonResponseSchema = z.object({
  membershipAddonId: z.string(),
  quotaTotal: z.number().int().nonnegative(),
  quotaUsed: z.number().int().nonnegative(),
  quotaRemaining: z.number().int(),
});

export type RedeemAddonResponse = z.infer<typeof redeemAddonResponseSchema>;
