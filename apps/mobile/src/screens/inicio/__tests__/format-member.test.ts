import { describe, expect, it } from 'vitest';

import { formatMemberSince } from '../format-member';

describe('formatMemberSince', () => {
  it('formats an ISO date as abbreviated PT-BR month and year', () => {
    expect(formatMemberSince('2026-03-14T12:00:00.000Z')).toBe('mar 2026');
  });

  it('handles January and December without off-by-one', () => {
    expect(formatMemberSince('2026-01-01T00:00:00.000Z')).toBe('jan 2026');
    expect(formatMemberSince('2026-12-31T23:59:59.000Z')).toBe('dez 2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatMemberSince('not-a-date')).toBe('');
  });
});
