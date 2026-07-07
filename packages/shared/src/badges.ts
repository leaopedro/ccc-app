import { z } from 'zod';

// Wire-format regex for a badge code (3 uppercase letters + dash + 3 digits).
// Source of truth for the catalog codes: EVT-001..EVT-003, CAR-001..CAR-003,
// COM-001..COM-003, JDM-001..JDM-003. Codes travel verbatim over the API and
// are referenced by GarageBadge.badgeCode (FK to Badge.code).
export const BADGE_CODE_RE = /^[A-Z]{3}-\d{3}$/;
export const badgeCodeSchema = z.string().regex(BADGE_CODE_RE);

export const badgeCategorySchema = z.enum(['eventos', 'carros', 'comunidade', 'jdm']);
export type BadgeCategory = z.infer<typeof badgeCategorySchema>;

export const badgeRaritySchema = z.enum(['common', 'rare', 'legendary']);
export type BadgeRarity = z.infer<typeof badgeRaritySchema>;

export const badgeCatalogEntrySchema = z.object({
  code: badgeCodeSchema,
  category: badgeCategorySchema,
  rarity: badgeRaritySchema,
  premiumExclusive: z.boolean(),
  icon: z.string().min(1).max(40),
});
export type BadgeCatalogEntry = z.infer<typeof badgeCatalogEntrySchema>;

// Owner-shape: includes locked + earned + lockedPremium states.
export const garageBadgeOwnerStateSchema = z.union([
  z.object({
    code: badgeCodeSchema,
    state: z.literal('earned'),
    earnedAt: z.string().datetime(),
    pinned: z.boolean(),
    pinnedAt: z.string().datetime().nullable(),
  }),
  z.object({ code: badgeCodeSchema, state: z.literal('locked') }),
  z.object({ code: badgeCodeSchema, state: z.literal('locked_premium') }),
]);
export type GarageBadgeOwnerState = z.infer<typeof garageBadgeOwnerStateSchema>;

// Public-shape: pinned earned only, ordered pinnedAt DESC NULLS LAST upstream.
export const garageBadgePublicSchema = z.object({
  code: badgeCodeSchema,
  earnedAt: z.string().datetime(),
});
export type GarageBadgePublic = z.infer<typeof garageBadgePublicSchema>;

export const garageBadgesPublicPayloadSchema = z.array(garageBadgePublicSchema);
export type GarageBadgesPublicPayload = z.infer<typeof garageBadgesPublicPayloadSchema>;

export const garageBadgesOwnerResponseSchema = z.object({
  enabled: z.boolean(),
  catalog: z.array(badgeCatalogEntrySchema),
  badges: z.array(garageBadgeOwnerStateSchema),
});
export type GarageBadgesOwnerResponse = z.infer<typeof garageBadgesOwnerResponseSchema>;

export const badgeCatalogResponseSchema = z.object({
  enabled: z.boolean(),
  catalog: z.array(badgeCatalogEntrySchema),
});
export type BadgeCatalogResponse = z.infer<typeof badgeCatalogResponseSchema>;
