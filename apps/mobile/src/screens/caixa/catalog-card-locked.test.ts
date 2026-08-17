import { describe, expect, it } from 'vitest';

import { lockedBadgeLabel } from './catalog-card-locked';

describe('lockedBadgeLabel', () => {
  it('formats the required tier', () => {
    expect(lockedBadgeLabel('silver')).toBe('Silver+');
    expect(lockedBadgeLabel('gold')).toBe('Gold+');
    expect(lockedBadgeLabel('bronze')).toBe('Bronze+');
  });
  it('returns null when no tier', () => {
    expect(lockedBadgeLabel(null)).toBe(null);
  });
});
