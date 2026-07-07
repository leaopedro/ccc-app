import { describe, expect, it } from 'vitest';

import { needsBanner, parseStoredConsent } from '../cookie-banner';

const CURRENT_VERSION = 'privacy-2026-05-14';

describe('parseStoredConsent', () => {
  it('returns null for null input', () => {
    expect(parseStoredConsent(null)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseStoredConsent('not-json')).toBeNull();
  });

  it('returns null when shape is wrong', () => {
    expect(parseStoredConsent(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it('returns null when analytics field is missing', () => {
    expect(parseStoredConsent(JSON.stringify({ version: CURRENT_VERSION }))).toBeNull();
  });

  it('parses valid stored consent', () => {
    const raw = JSON.stringify({ version: CURRENT_VERSION, analytics: true });
    expect(parseStoredConsent(raw)).toEqual({ version: CURRENT_VERSION, analytics: true });
  });

  it('parses analytics: false', () => {
    const raw = JSON.stringify({ version: CURRENT_VERSION, analytics: false });
    expect(parseStoredConsent(raw)).toEqual({ version: CURRENT_VERSION, analytics: false });
  });
});

describe('needsBanner', () => {
  it('returns true when nothing is stored', () => {
    expect(needsBanner(null)).toBe(true);
  });

  it('returns true for invalid stored value', () => {
    expect(needsBanner('garbage')).toBe(true);
  });

  it('returns true when version is outdated', () => {
    const raw = JSON.stringify({ version: 'privacy-2025-01-01', analytics: false });
    expect(needsBanner(raw)).toBe(true);
  });

  it('returns false when version matches and consent exists', () => {
    const raw = JSON.stringify({ version: CURRENT_VERSION, analytics: true });
    expect(needsBanner(raw)).toBe(false);
  });

  it('returns false for reject-all with matching version', () => {
    const raw = JSON.stringify({ version: CURRENT_VERSION, analytics: false });
    expect(needsBanner(raw)).toBe(false);
  });
});
