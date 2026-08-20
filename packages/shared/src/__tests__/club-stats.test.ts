import { describe, expect, it } from 'vitest';

import { clubStatsResponseSchema } from '../club-stats.js';

const VALID = { members: 128, events: 6, cars: 18 } as const;

describe('clubStatsResponseSchema', () => {
  it('accepts a valid payload and returns the parsed values', () => {
    expect(clubStatsResponseSchema.parse(VALID)).toEqual(VALID);
  });

  it('accepts zeros for a brand new club', () => {
    expect(clubStatsResponseSchema.parse({ members: 0, events: 0, cars: 0 })).toEqual({
      members: 0,
      events: 0,
      cars: 0,
    });
  });

  it('rejects a negative counter', () => {
    expect(() => clubStatsResponseSchema.parse({ ...VALID, members: -1 })).toThrow();
  });

  it('rejects a fractional counter', () => {
    expect(() => clubStatsResponseSchema.parse({ ...VALID, cars: 1.5 })).toThrow();
  });

  it('rejects a missing counter', () => {
    const { cars: _cars, ...missing } = VALID;
    expect(() => clubStatsResponseSchema.parse(missing)).toThrow();
  });

  it('strips unknown keys', () => {
    const parsed = clubStatsResponseSchema.parse({ ...VALID, secret: 'nope' });
    expect(parsed).not.toHaveProperty('secret');
  });
});
