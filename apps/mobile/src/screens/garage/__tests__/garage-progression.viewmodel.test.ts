// Chunk 40 — viewmodel unit tests for pickProfileStatsProps. Covers the
// derived shape, killswitch hide, missing-optional-fields hide, fresh-signup
// flag pass-through, and the focus-effect re-enable carry-over (skeleton
// §"Carry-over fold-ins" #3) — all driven through the pure helper.

import { describe, expect, it } from 'vitest';

import { pickProfileStatsProps } from '../garage-progression.viewmodel';

import {
  garageReadFixtureActiveOwner,
  garageReadFixtureAllFilled,
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureKillswitchOff,
  garageReadFixtureMixed,
} from './fixtures';

describe('pickProfileStatsProps', () => {
  it('returns the derived props on an active owner with metrics', () => {
    const r = pickProfileStatsProps(garageReadFixtureActiveOwner);
    expect(r).not.toBeNull();
    expect(r!.viewMode).toBe('owner');
    expect(r!.gamificationEnabled).toBe(true);
    expect(r!.progress.xp).toBe(137);
    expect(r!.stats.events).toBe(3);
    expect(r!.isFreshSignup).toBe(false);
  });

  it('returns null when gamification.enabled === false (killswitch)', () => {
    expect(pickProfileStatsProps(garageReadFixtureKillswitchOff)).toBeNull();
  });

  it('returns null when the API omitted progress/stats (§C10 optional shape)', () => {
    // Mid-flight envelope: enabled flag still true but blocks absent.
    const malformed = {
      ...garageReadFixtureMixed,
      gamification: { enabled: true },
      progress: undefined,
      stats: undefined,
    };
    expect(pickProfileStatsProps(malformed)).toBeNull();
  });

  it('flags fresh signup (mirrors showWelcomeBanner)', () => {
    const r = pickProfileStatsProps(garageReadFixtureEmptyFirstRun);
    expect(r).not.toBeNull();
    expect(r!.isFreshSignup).toBe(true);
  });

  it('non-fresh-signup user with no metrics still derives props (owner always renders)', () => {
    const r = pickProfileStatsProps(garageReadFixtureAllFilled);
    expect(r).not.toBeNull();
    expect(r!.isFreshSignup).toBe(false); // has cars, even with zero xp
    expect(r!.progress.xp).toBe(0);
  });

  it('killswitch re-enable mid-session re-derives correctly (carry-over §"fold-ins" #3)', () => {
    // First call: killswitch off → null. Then the route's useFocusEffect
    // refetches; the new payload has enabled=true + populated blocks. The
    // helper is pure, so calling it again with the new data flips to a value.
    expect(pickProfileStatsProps(garageReadFixtureKillswitchOff)).toBeNull();
    expect(pickProfileStatsProps(garageReadFixtureActiveOwner)).not.toBeNull();
  });
});
