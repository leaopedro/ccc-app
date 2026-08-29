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
 *
 * `subscriptionsEnabled` is the platform gate, resolved server-side from the
 * caller's `x-ccc-platform` header. It rides on the catalog reads because
 * those are the only premium routes that ALWAYS answer:
 * GET /api/premium/pricing 503s whenever GROWTH_PREMIUM_BILLING_ENABLED is
 * off, which is precisely when the gate would need to speak.
 */
export const premiumPlanListResponseSchema = z.object({
  plans: z.array(premiumPlanSchema),
  subscriptionsEnabled: z.boolean(),
});

export type PremiumPlanListResponse = z.infer<typeof premiumPlanListResponseSchema>;

/**
 * GET /api/plans/:slug — the plan fields FLATTENED with the gate, not
 * nested under a `plan` key. Already-installed binaries call this route and
 * parse the bare plan shape (`premiumPlanSchema`, which requires `tier`,
 * `slug`, etc.) directly; a nested `{ plan, subscriptionsEnabled }` envelope
 * would throw on every one of them the moment this deploys, since a bare
 * plan object has none of the fields `premiumPlanSchema` requires. Old
 * clients ignore the extra `subscriptionsEnabled` key; new clients read it.
 * `premiumPlanSchema` has no field named `subscriptionsEnabled`, so the
 * flatten cannot collide.
 */
export const premiumPlanDetailResponseSchema = premiumPlanSchema.extend({
  subscriptionsEnabled: z.boolean(),
});

export type PremiumPlanDetailResponse = z.infer<typeof premiumPlanDetailResponseSchema>;

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
  subscriptionsEnabled: z.boolean(),
});

export type PremiumAddonModuleListResponse = z.infer<typeof premiumAddonModuleListResponseSchema>;
