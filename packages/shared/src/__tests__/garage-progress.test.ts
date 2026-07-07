import { describe, expect, it } from 'vitest';

import {
  garageProgressSchema,
  garageStatsSchema,
  type GarageProgress,
  type GarageStats,
} from '../garage-progress.js';

const validProgress: GarageProgress = {
  xp: 1234,
  rank: 'Veterano',
  nextRank: 'Lendário',
  xpInTier: 234,
  xpToNextRank: 3766,
  tierSpan: 4000,
};

const validStats: GarageStats = {
  events: 12,
  posts: 4,
  likesReceived: 88,
  joinedAt: '2026-02-15T08:00:00.000Z',
};

describe('garageProgressSchema', () => {
  it('accepts canonical mid-tier shape', () => {
    expect(garageProgressSchema.parse(validProgress)).toEqual(validProgress);
  });

  it('accepts top-tier sentinel (nextRank=null, xpToNextRank=0, tierSpan=1)', () => {
    const top: GarageProgress = {
      xp: 50_000,
      rank: 'Hall of Fame',
      nextRank: null,
      xpInTier: 45_000,
      xpToNextRank: 0,
      tierSpan: 1,
    };
    expect(garageProgressSchema.parse(top)).toEqual(top);
  });

  it('accepts xp = 0 (fresh garage)', () => {
    expect(
      garageProgressSchema.parse({
        xp: 0,
        rank: 'Iniciante',
        nextRank: 'Aprendiz',
        xpInTier: 0,
        xpToNextRank: 100,
        tierSpan: 100,
      }),
    ).toBeTruthy();
  });

  it.each([
    ['xp', -1],
    ['xpInTier', -1],
    ['xpToNextRank', -1],
    ['tierSpan', 0],
    ['xp', 1.5],
    ['rank', ''],
    ['rank', 42],
    ['nextRank', ''],
  ] as const)('rejects bad %s = %p', (key, value) => {
    expect(() => garageProgressSchema.parse({ ...validProgress, [key]: value })).toThrow();
  });

  it('rejects missing required field', () => {
    const { xpInTier: _drop, ...partial } = validProgress;
    expect(() => garageProgressSchema.parse(partial)).toThrow();
  });
});

describe('garageStatsSchema', () => {
  it('accepts canonical shape', () => {
    expect(garageStatsSchema.parse(validStats)).toEqual(validStats);
  });

  it('accepts zero-default fresh garage', () => {
    expect(
      garageStatsSchema.parse({
        events: 0,
        posts: 0,
        likesReceived: 0,
        joinedAt: '2026-05-01T00:00:00.000Z',
      }),
    ).toBeTruthy();
  });

  it.each([
    ['events', -1],
    ['posts', -1],
    ['likesReceived', -1],
    ['events', 2.5],
    ['joinedAt', '2026-02-15'],
  ] as const)('rejects bad %s = %p', (key, value) => {
    expect(() => garageStatsSchema.parse({ ...validStats, [key]: value })).toThrow();
  });

  it('rejects missing joinedAt', () => {
    const { joinedAt: _drop, ...partial } = validStats;
    expect(() => garageStatsSchema.parse(partial)).toThrow();
  });
});
