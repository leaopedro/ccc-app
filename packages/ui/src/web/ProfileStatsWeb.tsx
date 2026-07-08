import type { GarageProgress, GarageStats } from '@ccc/shared/garage-progress';

import { StatsRowWeb } from './StatsRowWeb.js';
import { XPScoreboardWeb } from './XPScoreboardWeb.js';

export type ProfileStatsWebProps = {
  gamificationEnabled: boolean;
  progress?: GarageProgress | undefined;
  stats?: GarageStats | undefined;
};

/**
 * ProfileStatsWeb — SSR composite twin of the mobile ProfileStats
 * (chunk 39). Public-mode only; owner SSR has no surface per outline §303.
 *
 * Gate order:
 *   1. Killswitch — `gamificationEnabled === false` → null (canon §1).
 *   2. Missing-payload guard — either `progress` or `stats` absent → null
 *      (canon §2 / §C10).
 *   3. All-zero hide-on-empty — xp + events + posts + likesReceived all
 *      zero → null (canon §2 / outline §C10). API already strips when
 *      all-zero (chunk 28); this wrapper re-asserts the predicate as
 *      defence-in-depth.
 */
export function ProfileStatsWeb({ gamificationEnabled, progress, stats }: ProfileStatsWebProps) {
  if (!gamificationEnabled) return null;
  if (!progress || !stats) return null;
  if (progress.xp === 0 && stats.events === 0 && stats.posts === 0 && stats.likesReceived === 0) {
    return null;
  }
  return (
    <>
      <XPScoreboardWeb progress={progress} />
      <StatsRowWeb stats={stats} />
    </>
  );
}
