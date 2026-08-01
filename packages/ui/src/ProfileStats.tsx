import type { GarageProgress, GarageStats } from '@ccc/shared/garage-progress';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { StatsRow } from './StatsRow.js';
import { XPScoreboard } from './XPScoreboard.js';
import { XPTooltip } from './XPTooltip.js';

export interface ProfileStatsProps {
  /** Progress block from the wire payload. Omitted when killswitch off OR public hide-on-empty fires. */
  progress?: GarageProgress;
  /** Stats block from the wire payload. Same omission rules as `progress`. */
  stats?: GarageStats;
  /** `gamification.enabled` capability flag from the wire payload. */
  gamificationEnabled: boolean;
  /** Who is viewing. Drives the hide policy. */
  viewMode: 'owner' | 'public';
  /** Owner-only: when true (fresh signup, no activity yet), render nothing.
   *  Ignored when `viewMode === 'public'`. Public uses the all-zero predicate instead. */
  isFreshSignup?: boolean;
  testID?: string;
}

/** Composite owning tooltip state. Gate order: (1) killswitch, (2) owner-fresh,
 *  (3) public-all-zero. See phase2 plan §"Locked invariants" #2, §C5, §C10,
 *  §"Killswitch" line 511, §"Phase 2C" line 302. */
export function ProfileStats({
  progress,
  stats,
  gamificationEnabled,
  viewMode,
  isFreshSignup = false,
  testID,
}: ProfileStatsProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const onPressHint = useCallback(() => setTooltipOpen(true), []);
  const onClose = useCallback(() => setTooltipOpen(false), []);

  // (1) Killswitch wins regardless of view / freshness — §line 511.
  if (!gamificationEnabled) return null;
  // (2) Owner fresh-signup gate — §line 302 last sentence.
  if (viewMode === 'owner' && isFreshSignup) return null;
  // (3) Public hide-on-empty — §"Locked invariants" #2. Defence-in-depth.
  if (viewMode === 'public') {
    const isAllZero =
      (progress?.xp ?? 0) === 0 &&
      (stats?.events ?? 0) === 0 &&
      (stats?.posts ?? 0) === 0 &&
      (stats?.likesReceived ?? 0) === 0;
    if (isAllZero) return null;
  }
  // §C10 — past the three gates both should be present; never half-render.
  if (!progress || !stats) return null;

  return (
    <View testID={testID}>
      <XPScoreboard
        progress={progress}
        onPressHint={onPressHint}
        testID="profile-stats-scoreboard"
      />
      <StatsRow stats={stats} testID="profile-stats-row" />
      <XPTooltip visible={tooltipOpen} onClose={onClose} testID="profile-stats-tooltip" />
    </View>
  );
}
