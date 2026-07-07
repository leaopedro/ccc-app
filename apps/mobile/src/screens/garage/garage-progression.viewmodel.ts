// Chunk 40 — pure derivation of <ProfileStats /> props from the in-flight
// GarageReadResponse. Returns null when the API omitted progress/stats
// (killswitch off per outline §C10 .optional() semantics). Owner fresh-signup
// mirrors showWelcomeBanner — keep the predicate in lockstep with chunk 14.
//
// Killswitch path is response TOP-LEVEL `data.gamification.enabled` per
// outline §C10 / fix-canon §1. Do NOT read `data.garage.gamification.enabled`.

import type { GarageReadResponse } from '~/api/garage';
import { showWelcomeBanner } from '~/screens/garage/garage-header-gates';

export type ProfileStatsViewModel = {
  progress: NonNullable<GarageReadResponse['progress']>;
  stats: NonNullable<GarageReadResponse['stats']>;
  gamificationEnabled: boolean;
  isFreshSignup: boolean;
  viewMode: 'owner';
};

export const pickProfileStatsProps = (data: GarageReadResponse): ProfileStatsViewModel | null => {
  // Killswitch off OR API omitted blocks under §C10 .optional() → render-nothing.
  if (!data.gamification?.enabled) return null;
  if (!data.progress || !data.stats) return null;

  return {
    progress: data.progress,
    stats: data.stats,
    gamificationEnabled: data.gamification.enabled,
    isFreshSignup: showWelcomeBanner(data),
    viewMode: 'owner',
  };
};
