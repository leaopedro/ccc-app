import { describe, expect, it } from 'vitest';

import { serializeGarageOwner, serializeGaragePublic } from '../../src/services/garage/index.js';

const fakeUploads = { buildPublicUrl: (k: string) => `https://r2.test/${k}` };

// Default gamification context for serializer cover-lapse tests. Chunk 16
// extended both serializers to require a third arg carrying the killswitch +
// badge list; cover-lapse tests do not exercise that surface, so a neutral
// ctx (enabled: true, badges: []) keeps the contract honored without
// expanding the assertion set here.
const noGamification = { gamificationEnabled: true, badges: [] };

const baseGarage = (overrides: Partial<Parameters<typeof serializeGarageOwner>[0]> = {}) =>
  ({
    id: 'g1',
    userId: 'u1',
    name: 'Garagem',
    slug: 'user-12345678',
    description: null,
    isPublic: true,
    premiumTier: null as 'gold' | 'silver' | 'bronze' | null,
    premiumUntil: null as Date | null,
    coverPreset: null as string | null,
    coverImageObjectKey: null as string | null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as Parameters<typeof serializeGarageOwner>[0];

describe('serializeGarageOwner cover fields', () => {
  it('exposes raw coverImageObjectKey + resolved coverImageUrl', () => {
    const owner = serializeGarageOwner(
      baseGarage({
        coverImageObjectKey: 'garage-cover/u1/abc.jpg',
      }),
      fakeUploads,
      noGamification,
    );
    expect(owner.coverImageObjectKey).toBe('garage-cover/u1/abc.jpg');
    expect(owner.coverImageUrl).toBe('https://r2.test/garage-cover/u1/abc.jpg');
  });

  it('null coverImageObjectKey produces null coverImageUrl', () => {
    const owner = serializeGarageOwner(baseGarage(), fakeUploads, noGamification);
    expect(owner.coverImageObjectKey).toBeNull();
    expect(owner.coverImageUrl).toBeNull();
  });

  it('keeps raw cover values exposed even while premium has lapsed (renderer-side gating)', () => {
    const owner = serializeGarageOwner(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: new Date('2024-01-01T00:00:00Z'),
        coverPreset: 'tokyo-wangan',
        coverImageObjectKey: 'garage-cover/u1/abc.jpg',
      }),
      fakeUploads,
      noGamification,
    );
    expect(owner.isPremiumActive).toBe(false);
    expect(owner.coverPreset).toBe('tokyo-wangan');
    expect(owner.coverImageObjectKey).toBe('garage-cover/u1/abc.jpg');
    expect(owner.coverImageUrl).toBe('https://r2.test/garage-cover/u1/abc.jpg');
  });

  it('computes daysLeftUntilExpiry while premium is active', () => {
    const fiveDaysOut = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const owner = serializeGarageOwner(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: fiveDaysOut,
      }),
      fakeUploads,
      noGamification,
    );
    expect(owner.isPremiumActive).toBe(true);
    expect(owner.daysLeftUntilExpiry).not.toBeNull();
    expect(owner.daysLeftUntilExpiry).toBeGreaterThan(0);
  });

  it('daysLeftUntilExpiry is null when premium is inactive', () => {
    const owner = serializeGarageOwner(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: new Date('2024-01-01T00:00:00Z'),
      }),
      fakeUploads,
      noGamification,
    );
    expect(owner.daysLeftUntilExpiry).toBeNull();
  });
});

describe('serializeGaragePublic cover fields (no server-side masking per §C3)', () => {
  it('returns raw coverPreset + resolved coverImageUrl unconditionally', () => {
    const pub = serializeGaragePublic(
      baseGarage({
        coverPreset: 'tokyo-wangan',
        coverImageObjectKey: 'garage-cover/u1/abc.jpg',
      }),
      fakeUploads,
      noGamification,
    );
    expect(pub.coverPreset).toBe('tokyo-wangan');
    expect(pub.coverImageUrl).toBe('https://r2.test/garage-cover/u1/abc.jpg');
  });

  it('does NOT mask the cover when premium has lapsed (renderer is the gating site)', () => {
    const pub = serializeGaragePublic(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: new Date('2024-01-01T00:00:00Z'),
        coverPreset: 'tokyo-wangan',
        coverImageObjectKey: 'garage-cover/u1/abc.jpg',
      }),
      fakeUploads,
      noGamification,
    );
    expect(pub.isPremiumActive).toBe(false);
    expect(pub.coverPreset).toBe('tokyo-wangan');
    expect(pub.coverImageUrl).toBe('https://r2.test/garage-cover/u1/abc.jpg');
  });
});
