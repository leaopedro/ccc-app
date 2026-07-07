import { GARAGE_COVER_PRESETS, GARAGE_COVER_PRESET_SLUGS } from '@jdm/shared/garage-covers';
import type { Garage } from '@prisma/client';

import { computeIsPremiumActive } from './index.js';

// Chunk 03 §C1 + §C4: PATCH /me/garage/cover body is one of two union arms.
// Storage uses an R2 object key (NOT a URL), so the patch field is
// `coverImageObjectKey`. The renderer URL is built downstream from the key.
export type CoverPatch = { coverPreset: string | null } | { coverImageObjectKey: string | null };

const PREMIUM_PRESET_SLUGS: ReadonlySet<string> = new Set(
  GARAGE_COVER_PRESETS.filter((p) => p.premium).map((p) => p.slug),
);

export type CoverValidationResult =
  | { ok: true; patch: CoverPatch }
  | { ok: false; error: 'invalid_cover' | 'premium_required' };

/**
 * Validates a cover patch against the owner's premium status and the
 * ownership of any custom object key. The route layer relies on this
 * single point of truth so the audit + write path can stay terse.
 *
 *  - Free users: only the free `default-door` preset is allowed, and any
 *    custom upload (`coverImageObjectKey`) is rejected. Null clears.
 *  - Premium users: any preset slug from the catalog is allowed, plus a
 *    `coverImageObjectKey` literally prefixed with `garage-cover/<userId>/`.
 *    Null clears either field.
 */
export const validateCoverPatch = (garage: Garage, patch: CoverPatch): CoverValidationResult => {
  const isPremiumActive = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);

  if ('coverPreset' in patch) {
    const slug = patch.coverPreset;
    if (slug === null) return { ok: true, patch: { coverPreset: null } };
    if (!(GARAGE_COVER_PRESET_SLUGS as ReadonlySet<string>).has(slug)) {
      return { ok: false, error: 'invalid_cover' };
    }
    if (PREMIUM_PRESET_SLUGS.has(slug) && !isPremiumActive) {
      return { ok: false, error: 'premium_required' };
    }
    return { ok: true, patch: { coverPreset: slug } };
  }

  // coverImageObjectKey arm
  const key = patch.coverImageObjectKey;
  if (key === null) return { ok: true, patch: { coverImageObjectKey: null } };
  if (!isPremiumActive) return { ok: false, error: 'premium_required' };

  // Per-user ownership check. Zod has already enforced the shape via
  // garageCoverObjectKeyRe (`^garage-cover/[a-z0-9]+/[^/]+$`); here we
  // require the userId segment to be THIS garage's owner.
  const expectedPrefix = `garage-cover/${garage.userId}/`;
  if (!key.startsWith(expectedPrefix)) {
    return { ok: false, error: 'invalid_cover' };
  }
  return { ok: true, patch: { coverImageObjectKey: key } };
};
