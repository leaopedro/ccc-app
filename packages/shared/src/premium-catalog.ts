// packages/shared/src/premium-catalog.ts
// Premium subscription catalog — display-facing read schemas.
// Backs GET /api/plans, GET /api/plans/:slug, GET /api/addon-modules.
//
// Client-facing ONLY: provider price ids (stripePriceId/rcProductId) live on
// the DB rows but are intentionally NOT exposed here. Checkout/attach resolve
// them server-side in a later phase.

import { z } from 'zod';

/**
 * A single price point for a plan (one per cadence).
 * Provider price ids are deliberately omitted from the client shape.
 */
export const premiumPlanPriceSchema = z.object({
  cadence: z.enum(['monthly', 'annual']),
  baseAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
});

export type PremiumPlanPrice = z.infer<typeof premiumPlanPriceSchema>;

/**
 * A display benefit line for a plan. `sortOrder` drives render order.
 */
export const premiumPlanBenefitSchema = z.object({
  label: z.string(),
  sortOrder: z.number().int(),
});

export type PremiumPlanBenefit = z.infer<typeof premiumPlanBenefitSchema>;

/**
 * A premium plan — one per tier. Prices + benefits are embedded.
 */
export const premiumPlanSchema = z.object({
  tier: z.enum(['bronze', 'silver', 'gold']),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  prices: z.array(premiumPlanPriceSchema),
  benefits: z.array(premiumPlanBenefitSchema),
});

export type PremiumPlan = z.infer<typeof premiumPlanSchema>;

/**
 * GET /api/plans — full response.
 */
export const premiumPlanListResponseSchema = z.object({
  plans: z.array(premiumPlanSchema),
});

export type PremiumPlanListResponse = z.infer<typeof premiumPlanListResponseSchema>;

/**
 * A recurring add-on module. `quotaPerCycle`/`quotaUnit` describe the per-cycle
 * allowance; `monthlyDeltaCents` is the recurring price delta.
 */
export const premiumAddonModuleSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  monthlyDeltaCents: z.number().int().nonnegative(),
  currency: z.string(),
  quotaPerCycle: z.number().int(),
  quotaUnit: z.enum(['access', 'hours']),
  sortOrder: z.number().int(),
});

export type PremiumAddonModule = z.infer<typeof premiumAddonModuleSchema>;

/**
 * GET /api/addon-modules — full response.
 */
export const premiumAddonModuleListResponseSchema = z.object({
  modules: z.array(premiumAddonModuleSchema),
});

export type PremiumAddonModuleListResponse = z.infer<typeof premiumAddonModuleListResponseSchema>;
