import type { Prisma, PrismaClient } from '@prisma/client';

// ── Server-authoritative rank table ─────────────────────────────────────
//
// Five cosmetic tiers. The top tier ("Hall of Fame") is open-ended:
// `next === null` and `nextAt === null`. The §C14 correction requires
// `deriveProgress` to check `next === null` BEFORE reading `nextAt!`,
// and to emit `tierSpan = 1` (not 0) at the top so the UI progress bar
// can divide without a guard.
//
// This constant is SERVER-ONLY by design (skeleton chunk 26 + outline
// §260): clients never receive the thresholds, only the resolved
// payload. Do NOT re-export through `@jdm/shared`.
export const RANK_TIERS = [
  { name: 'Iniciante', min: 0, next: 'Pilotador', nextAt: 100 },
  { name: 'Pilotador', min: 100, next: 'Veterano', nextAt: 500 },
  { name: 'Veterano', min: 500, next: 'Lendário', nextAt: 2000 },
  { name: 'Lendário', min: 2000, next: 'Hall of Fame', nextAt: 5000 },
  { name: 'Hall of Fame', min: 5000, next: null, nextAt: null },
] as const;

export type RankName = (typeof RANK_TIERS)[number]['name'];

/**
 * The derived progress shape sent on the wire to mobile + admin clients.
 * Field order matches the outline §"Rank derivation" excerpt so a future
 * `garageProgressSchema` (chunk 2A.24) can `z.object({ ... })` against
 * the same key set in the same order.
 */
export type GarageProgress = {
  xp: number;
  rank: RankName;
  nextRank: RankName | null;
  xpInTier: number;
  xpToNextRank: number;
  tierSpan: number;
};

// Either the global Prisma client or a transaction client. Callers
// already inside a `$transaction` MUST pass the tx client so the read
// participates in the surrounding snapshot. Same shape as canon §3 in
// `2026-05-24-phase2-fix-canon.md` (matches `getGarageStats` in chunk 25).
type ReadClient = PrismaClient | Prisma.TransactionClient;

/**
 * Pure rank-derivation over the `RANK_TIERS` table. No DB access.
 *
 *  - Picks the highest tier whose `min` is ≤ `xp`.
 *  - Top-tier guard (§C14): when `tier.next === null`, returns
 *    `nextRank: null`, `xpToNextRank: 0`, and the `tierSpan = 1`
 *    sentinel so the UI can divide without dividing by zero.
 *  - Non-top tiers: `xpToNextRank = tier.nextAt - xp` (always ≥ 0
 *    because the iteration above already picked the matching tier),
 *    and `tierSpan = tier.nextAt - tier.min`.
 *
 * `xp` is treated as a non-negative integer (Garage.xp is `Int @default(0)`
 * and the awarder enforces non-negative writes — see chunk 27).
 */
export const deriveProgress = (xp: number): GarageProgress => {
  // Iterate from the highest tier down so the first match is correct.
  // `RANK_TIERS` is short + immutable; an indexed loop avoids a
  // throwaway `[...RANK_TIERS].reverse()` allocation per call.
  // `noUncheckedIndexedAccess` widens `RANK_TIERS[i]` to `T | undefined`,
  // so we bind the row to a local before the `min` compare.
  let tier: (typeof RANK_TIERS)[number] = RANK_TIERS[0];
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    const row = RANK_TIERS[i];
    if (row !== undefined && xp >= row.min) {
      tier = row;
      break;
    }
  }

  // §C14: top-tier guard must come BEFORE any `nextAt!` non-null read.
  const atTop = tier.next === null;
  if (atTop) {
    return {
      xp,
      rank: tier.name,
      nextRank: null,
      xpInTier: xp - tier.min,
      xpToNextRank: 0,
      tierSpan: 1,
    };
  }

  // `tier.nextAt` is non-null on non-top rows by construction.
  const nextAt = tier.nextAt as number;
  return {
    xp,
    rank: tier.name,
    nextRank: tier.next,
    xpInTier: xp - tier.min,
    xpToNextRank: nextAt - xp,
    tierSpan: nextAt - tier.min,
  };
};

/**
 * DB-backed wrapper. Reads `Garage.xp` by primary key and derives the
 * progress shape. Throws Prisma's `P2025` (RecordNotFound) when the
 * garage row does not exist — same semantics as Prisma's
 * `findUniqueOrThrow`, so the caller can rely on a non-null result.
 *
 * Killswitch gating is NOT applied here — the chunk-2A.28 serializer
 * decides whether to include the resulting block on the wire. Keeping
 * this service unconditional means an admin-side debug surface can
 * always inspect a user's progress even when the public surface is off.
 */
export const getGarageProgress = async (
  client: ReadClient,
  garageId: string,
): Promise<GarageProgress> => {
  const row = await client.garage.findUniqueOrThrow({
    where: { id: garageId },
    select: { xp: true },
  });
  return deriveProgress(row.xp);
};
