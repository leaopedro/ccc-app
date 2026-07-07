import { z } from 'zod';

import { garagePremiumTierSchema, garageSpotSourceSchema } from './garage.js';

// POST /admin/users/:id/garage/premium — grant or revoke a per-Garage premium
// membership. The `premiumUntil` key is always required (schema-strict); send
// `null` to indicate "no expiry" on grant. To grant, send a `tier` value with
// `premiumUntil: <iso>` or `premiumUntil: null`. To revoke, send `tier: null`
// AND `premiumUntil: null`. Mixed shapes (`tier: null` with a `premiumUntil`
// value) are rejected so the audit trail can't record a revoke when the
// caller intended a grant.
export const adminGaragePremiumSchema = z
  .object({
    tier: garagePremiumTierSchema.nullable(),
    premiumUntil: z.string().datetime().nullable(),
  })
  .strict()
  .refine((v) => !(v.tier === null && v.premiumUntil !== null), {
    message: 'premiumUntil must be null when revoking (tier: null)',
    path: ['premiumUntil'],
  });
export type AdminGaragePremiumInput = z.infer<typeof adminGaragePremiumSchema>;

// PATCH /admin/users/:id/garage — admin override of Garage profile fields.
// Slug rules: bypasses the user-side regex; uniqueness + reserved-slug list
// are still enforced (the latter in the route handler).
const adminGarageSlugSchema = z.string().trim().min(1).max(40);

export const adminGaragePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    slug: adminGarageSlugSchema,
    description: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().min(1).max(500).nullable(),
    ),
    isPublic: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminGaragePatchInput = z.infer<typeof adminGaragePatchSchema>;

// DELETE /admin/users/:id/garage/spots/:spotId — optional reason for the audit
// trail. Used by the manual-refund recipe.
export const adminGarageSpotRevokeBodySchema = z
  .object({
    reason: z.enum(['manual_refund', 'manual_cleanup']).default('manual_cleanup'),
  })
  .partial();
export type AdminGarageSpotRevokeBody = z.infer<typeof adminGarageSpotRevokeBodySchema>;

// Response shapes -------------------------------------------------------

export const adminGarageSummarySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
  premiumTier: garagePremiumTierSchema.nullable(),
  premiumUntil: z.string().datetime().nullable(),
  isPremiumActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminGarageSummary = z.infer<typeof adminGarageSummarySchema>;

export const adminGarageSpotRowSchema = z.object({
  id: z.string().min(1),
  source: garageSpotSourceSchema,
  carId: z.string().min(1).nullable(),
  sourceOrderItemId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
});
export type AdminGarageSpotRow = z.infer<typeof adminGarageSpotRowSchema>;

export const adminGarageReadSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string().email(),
  }),
  garage: adminGarageSummarySchema,
  spots: z.array(adminGarageSpotRowSchema),
});
export type AdminGarageRead = z.infer<typeof adminGarageReadSchema>;
