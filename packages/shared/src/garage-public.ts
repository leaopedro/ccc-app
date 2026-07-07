import { z } from 'zod';

import { garageBadgePublicSchema } from './badges.js';
import { carPhotoSchema } from './cars.js';
import { garageCoverPresetSchema } from './garage-covers.js';
import { garageProgressSchema, garageStatsSchema } from './garage-progress.js';
import { garageGamificationCapabilitySchema, garagePremiumTierSchema } from './garage.js';

// Public car shape. Allowlisted fields only — never userId, createdAt,
// updatedAt, spot info, or other internal details. See spec §4.2.
export const carPublicSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(20),
  modifications: z.array(z.string()),
  photos: z.array(carPhotoSchema),
});
export type CarPublic = z.infer<typeof carPublicSchema>;

// Public garage profile. Allowlisted fields only — never id, userId,
// premiumUntil, createdAt, updatedAt. `isPremiumActive` is computed in
// the serializer. See spec §4.2.
export const garagePublicProfileSchema = z.object({
  name: z.string().min(1).max(50),
  slug: z.string().min(1).max(40),
  description: z.string().max(500).nullable(),
  premiumTier: garagePremiumTierSchema.nullable(),
  coverPreset: garageCoverPresetSchema.nullable(),
  coverImageUrl: z.string().url().nullable(),
  isPremiumActive: z.boolean(),
  // Conquistas capability + pinned-only public badges. Pinned subset is
  // ordered pinnedAt DESC NULLS LAST upstream and premium-exclusive entries
  // are masked when the owner is not premium-active.
  gamification: garageGamificationCapabilitySchema,
  badges: z.array(garageBadgePublicSchema),
});
export type GaragePublicProfile = z.infer<typeof garagePublicProfileSchema>;

export const garagePublicResponseSchema = z.object({
  garage: garagePublicProfileSchema,
  cars: z.array(carPublicSchema),
  // Phase 2 (chunk 24, fix canon §1). Top-level gamification capability —
  // canonical read path is `body.gamification.enabled` for SSR + mobile.
  // Phase 1 nested `garage.gamification` stays for backward compat. Required
  // at chunk 28 per canon §1 "wire-always-present" invariant — both routes
  // emit unconditionally (`enabled: false` when the killswitch is off).
  gamification: garageGamificationCapabilitySchema,
  // Phase 2 (chunk 24, §C10 + plan review MAJOR). Top-level public badges
  // (pinned subset) — SSR reads `data.badges` directly. Phase 1 nested
  // `garage.badges` stays for backward compat. Optional for same boundary
  // reason as `gamification` above — chunk 28 makes the route always emit.
  badges: z.array(garageBadgePublicSchema).optional(),
  // Phase 2 (chunk 24, plan §C10). Both optional — route omits BOTH when
  // gamification.enabled === false (killswitch off) OR under the
  // public hide-on-empty rule (all metrics zero). Schema accepts both
  // presence + absence. See plan §"Killswitch".
  progress: garageProgressSchema.optional(),
  stats: garageStatsSchema.optional(),
});
export type GaragePublicResponse = z.infer<typeof garagePublicResponseSchema>;
