import { describe, expect, it } from 'vitest';

import {
  GARAGE_COVER_PRESETS,
  garageCoverPresetSchema,
  resolveGarageCoverSlug,
} from '../garage-covers.js';

describe('garageCoverPresetSchema', () => {
  it('accepts every catalog slug', () => {
    for (const preset of GARAGE_COVER_PRESETS) {
      expect(garageCoverPresetSchema.parse(preset.slug)).toBe(preset.slug);
    }
  });

  it('rejects an unknown slug', () => {
    expect(() => garageCoverPresetSchema.parse('not-a-real-cover')).toThrow();
  });

  it('exposes exactly one non-premium preset (default-door)', () => {
    const free = GARAGE_COVER_PRESETS.filter((p) => !p.premium);
    expect(free).toHaveLength(1);
    expect(free[0]?.slug).toBe('default-door');
  });

  it('every premium preset has a stable hex stripe + label', () => {
    for (const preset of GARAGE_COVER_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.stripe).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('resolveGarageCoverSlug', () => {
  it('masks a stored URL when premium has lapsed', () => {
    expect(resolveGarageCoverSlug(null, 'https://example.com/x.jpg', false)).toEqual({
      kind: 'preset',
      slug: 'default-door',
    });
  });

  it('masks a premium preset when premium has lapsed', () => {
    expect(resolveGarageCoverSlug('tokyo-wangan', null, false)).toEqual({
      kind: 'preset',
      slug: 'default-door',
    });
  });

  it('keeps the free default-door preset for non-premium users', () => {
    expect(resolveGarageCoverSlug('default-door', null, false)).toEqual({
      kind: 'preset',
      slug: 'default-door',
    });
  });

  it('prefers the stored URL when premium is active', () => {
    expect(resolveGarageCoverSlug(null, 'https://example.com/x.jpg', true)).toEqual({
      kind: 'url',
      url: 'https://example.com/x.jpg',
    });
  });

  it('renders a premium preset when premium is active', () => {
    expect(resolveGarageCoverSlug('tokyo-wangan', null, true)).toEqual({
      kind: 'preset',
      slug: 'tokyo-wangan',
    });
  });

  it('falls back to default-door when the stored slug is not in the catalog', () => {
    expect(resolveGarageCoverSlug('not-in-catalog', null, true)).toEqual({
      kind: 'preset',
      slug: 'default-door',
    });
  });

  it('falls back to default-door when nothing is stored', () => {
    expect(resolveGarageCoverSlug(null, null, true)).toEqual({
      kind: 'preset',
      slug: 'default-door',
    });
  });
});
