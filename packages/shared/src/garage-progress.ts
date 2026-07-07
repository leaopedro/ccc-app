import { z } from 'zod';

// GarageProgress — server-authoritative rank-derivation payload block.
//
// Shape: outline §"API surface" lines 380-391. Rank-label derivation
// (RANK_TIERS + deriveProgress) lives in apps/api/src/services/garage/
// progress.ts — server-only, intentionally NOT exported via shared so the
// label catalog stays trivially mutable without forcing a client redeploy.
// This schema carries only the wire payload; `rank` + `nextRank` are
// validated as opaque non-empty strings.
//
// Top-tier sentinel per §C14: nextRank=null, xpToNextRank=0, tierSpan=1
// (avoids division-by-zero in the UI progress bar).
export const garageProgressSchema = z.object({
  xp: z.number().int().nonnegative(),
  rank: z.string().min(1),
  nextRank: z.string().min(1).nullable(),
  xpInTier: z.number().int().nonnegative(),
  xpToNextRank: z.number().int().nonnegative(),
  tierSpan: z.number().int().min(1),
});
export type GarageProgress = z.infer<typeof garageProgressSchema>;

// GarageStats — the 4-tile profile stats block (events / posts / likes /
// joined). Shape: outline §"API surface" lines 393-402. `likesReceived`
// MUST be read from the denormalized Garage.likesReceived column per §C4
// (the awarder maintains it in the same tx as the XP write); never an
// aggregate over FeedReaction. `joinedAt` is an ISO datetime — serializer
// (chunk 25) sources it from Garage.createdAt (Deviation 3). All counters
// are non-negative integers so a fresh garage with zero activity parses.
export const garageStatsSchema = z.object({
  events: z.number().int().nonnegative(),
  posts: z.number().int().nonnegative(),
  likesReceived: z.number().int().nonnegative(),
  joinedAt: z.string().datetime(),
});
export type GarageStats = z.infer<typeof garageStatsSchema>;
