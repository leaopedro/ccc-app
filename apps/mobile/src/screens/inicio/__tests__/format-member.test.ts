import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatMemberSince } from '../format-member';

// formatMemberSince now reads LOCAL getters (final review, Item C), so its
// output depends on the test runner's timezone. Pin TZ to the app's real
// audience (BRT, UTC-3, no DST) for the duration of this file so results are
// deterministic regardless of what the CI box or a dev machine defaults to.
// Node re-reads process.env.TZ lazily on every Date computation, so setting
// it here (before any formatMemberSince call in this file) is enough —
// restored in afterAll so it can't leak into another test file sharing this
// worker.
let originalTZ: string | undefined;

beforeAll(() => {
  originalTZ = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
});

afterAll(() => {
  process.env.TZ = originalTZ;
});

describe('formatMemberSince', () => {
  it('formats an ISO date as abbreviated PT-BR month and year', () => {
    expect(formatMemberSince('2026-03-14T12:00:00.000Z')).toBe('mar 2026');
  });

  it('handles January and December without off-by-one', () => {
    expect(formatMemberSince('2026-01-01T12:00:00.000Z')).toBe('jan 2026');
    expect(formatMemberSince('2026-12-31T12:00:00.000Z')).toBe('dez 2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatMemberSince('not-a-date')).toBe('');
  });

  it('uses the local date, not UTC, at a late-night BRT boundary', () => {
    // 2026-02-28T23:30 BRT (UTC-3) is 2026-03-01T02:30Z. UTC getters would
    // read this as March; local (BRT) getters correctly read February.
    expect(formatMemberSince('2026-03-01T02:30:00.000Z')).toBe('fev 2026');
  });
});
