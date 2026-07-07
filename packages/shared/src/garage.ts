import { z } from 'zod';

import { garageBadgeOwnerStateSchema } from './badges.js';
import { carSchema } from './cars.js';
import { garageCoverPresetSchema } from './garage-covers.js';
import { garageProgressSchema, garageStatsSchema } from './garage-progress.js';

export const garageSpotSourceSchema = z.enum([
  'default_free',
  'purchase',
  'admin_grant',
  'premium_membership',
]);
export type GarageSpotSource = z.infer<typeof garageSpotSourceSchema>;

export const garagePremiumTierSchema = z.enum(['bronze', 'silver', 'gold']);
export type GaragePremiumTier = z.infer<typeof garagePremiumTierSchema>;

// R2 object-key shape for the user's custom garage cover. Caller-side
// enforced to start with `garage-cover/<userId>/` so a malicious patch can't
// repoint the row at someone else's object.
const garageCoverObjectKeyRe = /^garage-cover\/[a-z0-9]+\/[^/]+$/i;
export const garageCoverObjectKeySchema = z.string().regex(garageCoverObjectKeyRe);

// Public shape for GET /me/garage spots[]. No `tier` field — free vs extra
// is derived from `source` (default_free = free, anything else = extra).
export const garageSpotSchema = z.object({
  id: z.string().min(1),
  source: garageSpotSourceSchema,
  carId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
});
export type GarageSpot = z.infer<typeof garageSpotSchema>;

// Reserved slugs cannot be claimed via PATCH /me/garage. They collide with
// existing top-level routes or admin paths. Keep in sync with spec §2.1.
export const GARAGE_RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'me',
  'cart',
  'g',
  'store',
  'health',
  'auth',
  'signup',
  'login',
]);

// Capability flag for gamification (Conquistas + future XP) — sourced from
// GeneralSettings.gamificationEnabled, read synchronously every request. Plan
// §15.6 + kickoff lock: no cache, admin toggles propagate in < 1s. The flag
// is exported standalone here so chunk 16 can also import it into
// garage-public.ts for the public profile carry-over.
export const garageGamificationCapabilitySchema = z.object({
  enabled: z.boolean(),
});
export type GarageGamificationCapability = z.infer<typeof garageGamificationCapabilitySchema>;

// Owner-facing garage shape. Includes premium fields and isPremiumActive
// (computed in serializer). Spots and cars are returned as siblings of
// garage, not nested under it, to mirror the existing /me/garage shape.
export const garageOwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric or hyphen'),
  description: z.string().max(500).nullable(),
  isPublic: z.boolean(),
  premiumTier: garagePremiumTierSchema.nullable(),
  premiumUntil: z.string().datetime().nullable(),
  isPremiumActive: z.boolean(),
  coverPreset: garageCoverPresetSchema.nullable(),
  coverImageObjectKey: garageCoverObjectKeySchema.nullable(),
  coverImageUrl: z
    .string()
    .url()
    .regex(/\/garage-cover\//)
    .nullable(),
  daysLeftUntilExpiry: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Conquistas capability surface — server populates from
  // GeneralSettings.gamificationEnabled per request (no cache).
  gamification: garageGamificationCapabilitySchema,
  // Owner-shape badges. Includes catalog entries the user has not earned
  // (state: 'locked' or 'locked_premium'). Pinned subset surfaces on the
  // public profile. See plan §15.6 + chunk 16.
  badges: z.array(garageBadgeOwnerStateSchema),
});
export type GarageOwner = z.infer<typeof garageOwnerSchema>;

export const garageReadSchema = z.object({
  garage: garageOwnerSchema,
  cars: z.array(carSchema),
  spots: z.array(garageSpotSchema),
  availableSlots: z.number().int().nonnegative(),
  freeLimit: z.number().int().nonnegative().nullable(),
  isUnlimited: z.boolean(),
  // Phase 2 (chunk 24, plan §C10 + fix canon §1). Top-level gamification
  // capability — canonical read path is `body.gamification.enabled`. The
  // Phase 1 nested `garage.gamification` stays for backward compat; chunks
  // 28/40 read this top-level field per fix canon §1. Required at chunk 28
  // per canon §1 "wire-always-present" invariant — both routes emit
  // unconditionally (`enabled: false` when the killswitch is off).
  gamification: garageGamificationCapabilitySchema,
  // Both optional — the killswitch-off branch where the route omits BOTH
  // blocks must still validate. The route-layer invariant (biconditional
  // with gamification.enabled) is enforced in chunk 28, not here.
  progress: garageProgressSchema.optional(),
  stats: garageStatsSchema.optional(),
});
export type GarageRead = z.infer<typeof garageReadSchema>;

// PATCH /me/garage — all fields optional, full constraint set when present.
// Reserved-slug check happens in the route handler (data-driven set, not regex).
//
// Slug field uses .superRefine so a regex violation surfaces a distinct
// `invalid_slug` ZodIssue. The route catches the ZodError, scans issues, and
// returns `400 { error: 'invalid_slug' }` instead of zod's generic 400.
// Without this split the UX cannot disambiguate "slug already taken" (409)
// from "slug has invalid characters" (400 generic) — plan §C7.
export const garagePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .superRefine((value, ctx) => {
        if (!/^[a-z0-9-]+$/.test(value)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_slug' });
        }
      }),
    description: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().min(1).max(500).nullable(),
    ),
    isPublic: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type GaragePatch = z.infer<typeof garagePatchSchema>;

// Bound to PATCH /me/garage/cover (chunk 03). Union of mutually-exclusive
// patch shapes so a single request can change EITHER the preset OR the
// custom upload, never both at once.
export const garageCoverPatchSchema = z.union([
  z.object({ coverPreset: garageCoverPresetSchema.nullable() }).strict(),
  z.object({ coverImageObjectKey: garageCoverObjectKeySchema.nullable() }).strict(),
]);
export type GarageCoverPatch = z.infer<typeof garageCoverPatchSchema>;

// Singleton identifiers re-exported for cross-app use (mobile, admin) where importing
// from @jdm/db is awkward. Keep in sync with packages/db/src/garage-spot-product.ts.
export const GARAGE_SPOT_PRODUCT_SLUG = 'garage-spot';
export const GARAGE_SPOT_PRODUCT_TYPE_NAME = 'garage_spot';
