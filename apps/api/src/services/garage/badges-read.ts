import { prisma } from '@ccc/db';
import type { BadgeCatalogEntry, GarageBadgeOwnerState } from '@ccc/shared/badges';
import type { Garage } from '@prisma/client';

import { computeIsPremiumActive } from './index.js';

export type OwnerBadgesState = {
  catalog: BadgeCatalogEntry[];
  badges: GarageBadgeOwnerState[];
  isPremiumActive: boolean;
};

/**
 * Owner-state aggregator for GET /me/garage/badges + the owner serializer
 * spread on GET /me/garage. Joins the full catalog with the user's earned
 * rows and classifies each catalog entry into one of three states:
 *
 *   - `earned`         — present in `GarageBadge`, carries earnedAt + pinned + pinnedAt.
 *   - `locked_premium` — premiumExclusive AND owner is not premium-active.
 *   - `locked`         — anything else (not earned, not premium-gated).
 *
 * Premium-exclusive entries are still REVEALED in the catalog payload (the
 * client needs to know they exist + render the upsell affordance); the
 * locked_premium state is what gates them. Owner sees their own earned
 * badges regardless of premium-active.
 */
export const readOwnerBadgesState = async (garage: Garage): Promise<OwnerBadgesState> => {
  const isPremiumActive = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  const [catalogRows, earnedRows] = await Promise.all([
    prisma.badge.findMany({ orderBy: { code: 'asc' } }),
    prisma.garageBadge.findMany({
      where: { garageId: garage.id },
      orderBy: { earnedAt: 'desc' },
    }),
  ]);

  const earnedMap = new Map(earnedRows.map((row) => [row.badgeCode, row]));

  const catalog: BadgeCatalogEntry[] = catalogRows.map((b) => ({
    code: b.code,
    category: b.category,
    rarity: b.rarity,
    premiumExclusive: b.premiumExclusive,
    icon: b.icon,
  }));

  const badges: GarageBadgeOwnerState[] = catalogRows.map((b) => {
    const earned = earnedMap.get(b.code);
    if (earned) {
      return {
        code: b.code,
        state: 'earned',
        earnedAt: earned.earnedAt.toISOString(),
        pinned: earned.pinned,
        pinnedAt: earned.pinnedAt ? earned.pinnedAt.toISOString() : null,
      };
    }
    if (b.premiumExclusive && !isPremiumActive) {
      return { code: b.code, state: 'locked_premium' };
    }
    return { code: b.code, state: 'locked' };
  });

  return { catalog, badges, isPremiumActive };
};

/**
 * Public-side helper: pinned earned only, ordered pinnedAt DESC NULLS LAST,
 * premium-exclusive entries hidden while the owner is not premium-active.
 *
 * The premium-exclusive mask lives HERE rather than in the serializer so the
 * Prisma `where` predicate carries the cull at query time (no over-fetch).
 * Owner-side keeps premium-exclusive badges visible — owners see their own
 * earned badges regardless.
 */
export const readPublicBadges = async (
  garage: Garage,
): Promise<Array<{ code: string; earnedAt: string }>> => {
  const isPremiumActive = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  const rows = await prisma.garageBadge.findMany({
    where: {
      garageId: garage.id,
      pinned: true,
      ...(isPremiumActive ? {} : { badge: { premiumExclusive: false } }),
    },
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }],
  });
  return rows.map((r) => ({ code: r.badgeCode, earnedAt: r.earnedAt.toISOString() }));
};
