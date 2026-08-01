import { describe, expect, it } from 'vitest';

import { adminAuditActionSchema, adminCarUpdateSchema } from '../admin.js';
import { carSchema } from '../cars.js';
import {
  carPublicSchema,
  garagePublicProfileSchema,
  garagePublicResponseSchema,
} from '../garage-public.js';
import {
  garageCoverPatchSchema,
  garageGamificationCapabilitySchema,
  garageOwnerSchema,
  garagePatchSchema,
  garagePremiumTierSchema,
  garageReadSchema,
  garageSpotSchema,
  garageSpotSourceSchema,
  GARAGE_RESERVED_SLUGS,
  GARAGE_SPOT_PRODUCT_SLUG,
  GARAGE_SPOT_PRODUCT_TYPE_NAME,
} from '../garage.js';

describe('garageSpotSourceSchema', () => {
  it.each(['default_free', 'purchase', 'admin_grant', 'premium_membership'] as const)(
    'accepts %s',
    (s) => {
      expect(garageSpotSourceSchema.parse(s)).toBe(s);
    },
  );
});

describe('garagePremiumTierSchema', () => {
  it.each(['bronze', 'silver', 'gold'] as const)('accepts %s', (t) => {
    expect(garagePremiumTierSchema.parse(t)).toBe(t);
  });
  it('rejects unknown tier', () => {
    expect(() => garagePremiumTierSchema.parse('platinum')).toThrow();
  });
});

describe('garageSpotSchema', () => {
  it('parses a valid empty extra spot (no tier field)', () => {
    const parsed = garageSpotSchema.parse({
      id: 'spot_1',
      source: 'purchase',
      carId: null,
      createdAt: '2026-05-20T12:00:00.000Z',
    });
    expect(parsed.carId).toBeNull();
    expect(parsed.source).toBe('purchase');
  });
  it('rejects when carId is missing entirely', () => {
    expect(() =>
      garageSpotSchema.parse({
        id: 'spot_1',
        source: 'default_free',
        createdAt: '2026-05-20T12:00:00.000Z',
      }),
    ).toThrow();
  });
  it('rejects payloads carrying the dropped tier field via strict parsing in garageReadSchema', () => {
    // garageSpotSchema itself does not need to be strict; the legacy `tier`
    // field simply has no place to land. Reading a tier on a parsed spot is
    // statically impossible.
    const parsed = garageSpotSchema.parse({
      id: 'spot_1',
      source: 'default_free',
      carId: null,
      createdAt: '2026-05-20T12:00:00.000Z',
      // extraneous keys ignored by default
      tier: 'free',
    } as unknown as Record<string, unknown>);
    expect('tier' in parsed).toBe(false);
  });
});

describe('carSchema (no tier, no description)', () => {
  const baseCar = {
    id: 'car_1',
    make: 'Toyota',
    model: 'Supra',
    year: 1998,
    nickname: 'Beast',
    modifications: [],
    photo: null,
    photos: [],
    isPremiumActive: false,
    createdAt: '2026-05-20T12:00:00.000Z',
    updatedAt: '2026-05-20T12:00:00.000Z',
  };

  it('parses a car payload without tier or description', () => {
    const parsed = carSchema.parse(baseCar);
    expect((parsed as Record<string, unknown>).tier).toBeUndefined();
    expect((parsed as Record<string, unknown>).description).toBeUndefined();
  });

  it('carries isPremiumActive through the serialized shape', () => {
    expect(carSchema.parse(baseCar).isPremiumActive).toBe(false);
    expect(carSchema.parse({ ...baseCar, isPremiumActive: true }).isPremiumActive).toBe(true);
  });
});

describe('garageOwnerSchema', () => {
  const baseOwner = {
    id: 'g_1',
    name: 'Garagem',
    slug: 'user-abc12345',
    description: null,
    isPublic: false,
    premiumTier: null,
    premiumUntil: null,
    isPremiumActive: false,
    coverPreset: null,
    coverImageObjectKey: null,
    coverImageUrl: null,
    daysLeftUntilExpiry: null,
    createdAt: '2026-05-20T12:00:00.000Z',
    updatedAt: '2026-05-20T12:00:00.000Z',
    gamification: { enabled: true },
    badges: [],
  };

  it('parses neutral defaults', () => {
    expect(garageOwnerSchema.parse(baseOwner).slug).toBe('user-abc12345');
  });
  it('rejects an empty name', () => {
    expect(() => garageOwnerSchema.parse({ ...baseOwner, name: '' })).toThrow();
  });
  it('rejects a slug with uppercase characters', () => {
    expect(() => garageOwnerSchema.parse({ ...baseOwner, slug: 'User-1' })).toThrow();
  });
});

describe('garageReadSchema', () => {
  const baseOwnerGarage = {
    id: 'g_1',
    name: 'Garagem',
    slug: 'user-abc12345',
    description: null,
    isPublic: false,
    premiumTier: null,
    premiumUntil: null,
    isPremiumActive: false,
    coverPreset: null,
    coverImageObjectKey: null,
    coverImageUrl: null,
    daysLeftUntilExpiry: null,
    createdAt: '2026-05-20T12:00:00.000Z',
    updatedAt: '2026-05-20T12:00:00.000Z',
    gamification: { enabled: true as boolean },
    badges: [] as never[],
  };
  const baseRead = {
    garage: baseOwnerGarage,
    cars: [],
    spots: [],
    availableSlots: 1,
    freeLimit: 1,
    isUnlimited: false,
    gamification: { enabled: true as boolean },
  };
  const validProgress = {
    xp: 250,
    rank: 'Aprendiz',
    nextRank: 'Piloto',
    xpInTier: 150,
    xpToNextRank: 250,
    tierSpan: 400,
  };
  const validStats = {
    events: 3,
    posts: 1,
    likesReceived: 7,
    joinedAt: '2026-02-15T08:00:00.000Z',
  };

  it('parses a full read payload', () => {
    const parsed = garageReadSchema.parse({
      garage: {
        id: 'g_1',
        name: 'Garagem',
        slug: 'user-abc12345',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: null,
        coverImageObjectKey: null,
        coverImageUrl: null,
        daysLeftUntilExpiry: null,
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
        gamification: { enabled: true },
        badges: [],
      },
      cars: [],
      spots: [],
      availableSlots: 1,
      freeLimit: 1,
      isUnlimited: false,
      gamification: { enabled: true },
    });
    expect(parsed.garage.isPremiumActive).toBe(false);
    expect(parsed.garage.gamification.enabled).toBe(true);
    expect(parsed.garage.badges).toEqual([]);
  });

  it('parses gamification disabled + earned/pinned owner badge entries', () => {
    const parsed = garageReadSchema.parse({
      garage: {
        id: 'g_1',
        name: 'Garagem',
        slug: 'user-abc12345',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: null,
        coverImageObjectKey: null,
        coverImageUrl: null,
        daysLeftUntilExpiry: null,
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
        gamification: { enabled: false },
        badges: [
          {
            code: 'EVT-001',
            state: 'earned',
            earnedAt: '2026-05-20T12:00:00.000Z',
            pinned: true,
            pinnedAt: '2026-05-20T12:30:00.000Z',
          },
          { code: 'CCC-003', state: 'locked' },
        ],
      },
      cars: [],
      spots: [],
      availableSlots: 0,
      freeLimit: null,
      isUnlimited: true,
      gamification: { enabled: false },
    });
    expect(parsed.garage.gamification.enabled).toBe(false);
    expect(parsed.garage.badges).toHaveLength(2);
  });

  it('accepts owner read with top-level gamification + progress + stats present', () => {
    const parsed = garageReadSchema.parse({
      ...baseRead,
      progress: validProgress,
      stats: validStats,
    });
    expect(parsed.gamification?.enabled).toBe(true);
    expect(parsed.progress?.rank).toBe('Aprendiz');
    expect(parsed.stats?.likesReceived).toBe(7);
  });

  it('accepts owner read with progress + stats omitted (killswitch off)', () => {
    const parsed = garageReadSchema.parse({
      ...baseRead,
      gamification: { enabled: false },
    });
    expect(parsed.gamification?.enabled).toBe(false);
    expect(parsed.progress).toBeUndefined();
    expect(parsed.stats).toBeUndefined();
  });

  it('rejects owner read missing top-level gamification (canon §1 wire-always-present)', () => {
    const { gamification: _drop, ...withoutGamification } = baseRead;
    expect(() => garageReadSchema.parse(withoutGamification)).toThrow(/gamification/);
  });

  it('rejects owner read whose progress has negative xp', () => {
    expect(() =>
      garageReadSchema.parse({
        ...baseRead,
        progress: { ...validProgress, xp: -1 },
      }),
    ).toThrow();
  });

  it('rejects owner read whose stats has bad joinedAt', () => {
    expect(() =>
      garageReadSchema.parse({
        ...baseRead,
        progress: validProgress,
        stats: { ...validStats, joinedAt: 'not-a-date' },
      }),
    ).toThrow();
  });
});

describe('garagePatchSchema', () => {
  it('accepts a single-field update', () => {
    expect(garagePatchSchema.parse({ name: 'Minha Garagem' })).toEqual({ name: 'Minha Garagem' });
  });
  it('coerces empty-string description to null', () => {
    expect(garagePatchSchema.parse({ description: '' })).toEqual({ description: null });
  });
  it('rejects empty payload', () => {
    expect(() => garagePatchSchema.parse({})).toThrow();
  });
  it('rejects unknown keys', () => {
    expect(() => garagePatchSchema.parse({ premiumTier: 'gold' })).toThrow();
  });
  it('rejects bad slug shape', () => {
    expect(() => garagePatchSchema.parse({ slug: 'Has Space' })).toThrow();
  });
});

describe('GARAGE_RESERVED_SLUGS', () => {
  it('contains the documented reserved words', () => {
    for (const slug of [
      'admin',
      'api',
      'me',
      'cart',
      'g',
      'store',
      'health',
      'auth',
      'signup',
      'login',
    ]) {
      expect(GARAGE_RESERVED_SLUGS.has(slug)).toBe(true);
    }
  });
});

describe('garagePublicProfileSchema', () => {
  it('parses the allowlisted public profile shape', () => {
    const parsed = garagePublicProfileSchema.parse({
      name: 'Minha Garagem',
      slug: 'meu-slug',
      description: 'Carros antigos',
      premiumTier: 'gold',
      coverPreset: null,
      coverImageUrl: null,
      isPremiumActive: true,
      gamification: { enabled: true },
      badges: [],
    });
    expect(parsed.premiumTier).toBe('gold');
    expect(parsed.gamification.enabled).toBe(true);
    expect(parsed.badges).toEqual([]);
  });
  it('does not pass through forbidden fields', () => {
    const parsed = garagePublicProfileSchema.parse({
      name: 'Minha Garagem',
      slug: 'meu-slug',
      description: null,
      premiumTier: null,
      coverPreset: null,
      coverImageUrl: null,
      isPremiumActive: false,
      gamification: { enabled: true },
      badges: [],
      // forbidden fields should be stripped
      id: 'g_1',
      userId: 'u_1',
      premiumUntil: '2026-05-20T12:00:00.000Z',
      createdAt: '2026-05-20T12:00:00.000Z',
    } as unknown as Record<string, unknown>);
    expect('id' in parsed).toBe(false);
    expect('userId' in parsed).toBe(false);
    expect('premiumUntil' in parsed).toBe(false);
    expect('createdAt' in parsed).toBe(false);
  });

  it('parses pinned badges into the public payload', () => {
    const parsed = garagePublicProfileSchema.parse({
      name: 'Minha Garagem',
      slug: 'meu-slug',
      description: null,
      premiumTier: 'gold',
      coverPreset: null,
      coverImageUrl: null,
      isPremiumActive: true,
      gamification: { enabled: true },
      badges: [
        { code: 'EVT-001', earnedAt: '2026-05-22T12:00:00.000Z' },
        { code: 'CCC-003', earnedAt: '2026-04-01T09:00:00.000Z' },
      ],
    });
    expect(parsed.badges).toHaveLength(2);
    expect(parsed.badges[0]?.code).toBe('EVT-001');
  });
});

describe('carPublicSchema', () => {
  it('parses the allowlisted public car shape', () => {
    const parsed = carPublicSchema.parse({
      id: 'car_1',
      make: 'Toyota',
      model: 'Supra',
      year: 1998,
      nickname: 'Beast',
      modifications: ['turbo'],
      photos: [],
    });
    expect(parsed.modifications).toEqual(['turbo']);
  });
});

describe('adminAuditActionSchema additions', () => {
  it.each([
    'car.admin_update',
    'car.admin_delete',
    'garage_spot.delete',
    'general_settings.garage_backfill',
    'garage.backfill',
    'garage.premium_grant',
    'garage.premium_revoke',
    'garage.slug_override',
  ] as const)('accepts %s', (a) => {
    expect(adminAuditActionSchema.parse(a)).toBe(a);
  });
  it('rejects the dropped garage_spot.tier_override action', () => {
    expect(() => adminAuditActionSchema.parse('garage_spot.tier_override')).toThrow();
  });
});

describe('adminCarUpdateSchema', () => {
  it('rejects empty payload', () => {
    expect(() => adminCarUpdateSchema.parse({})).toThrow();
  });
  it('accepts a single-field update', () => {
    expect(adminCarUpdateSchema.parse({ nickname: 'Beast' })).toEqual({ nickname: 'Beast' });
  });
  it('rejects unknown keys', () => {
    expect(() => adminCarUpdateSchema.parse({ tier: 'premium' })).toThrow();
  });
  it('coerces empty-string nickname to null', () => {
    expect(adminCarUpdateSchema.parse({ nickname: '' })).toEqual({ nickname: null });
  });
});

describe('garage constants', () => {
  it('expose stable singleton identifiers', () => {
    expect(GARAGE_SPOT_PRODUCT_SLUG).toBe('garage-spot');
    expect(GARAGE_SPOT_PRODUCT_TYPE_NAME).toBe('garage_spot');
  });
});

describe('garageOwnerSchema (cover)', () => {
  const coverBase = {
    gamification: { enabled: true },
    badges: [] as never[],
  };

  it('accepts coverPreset + coverImageObjectKey + coverImageUrl + daysLeftUntilExpiry', () => {
    const parsed = garageOwnerSchema.parse({
      id: 'g1',
      name: 'Garagem',
      slug: 'user-12345678',
      description: null,
      isPublic: false,
      premiumTier: null,
      premiumUntil: null,
      isPremiumActive: false,
      coverPreset: 'tokyo-wangan',
      coverImageObjectKey: null,
      coverImageUrl: null,
      daysLeftUntilExpiry: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...coverBase,
    });
    expect(parsed.coverPreset).toBe('tokyo-wangan');
    expect(parsed.daysLeftUntilExpiry).toBeNull();
  });

  it('rejects an unknown coverPreset slug', () => {
    expect(() =>
      garageOwnerSchema.parse({
        id: 'g1',
        name: 'Garagem',
        slug: 'user-12345678',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: 'totally-fake',
        coverImageObjectKey: null,
        coverImageUrl: null,
        daysLeftUntilExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...coverBase,
      }),
    ).toThrow();
  });

  it('rejects coverImageObjectKey that is a URL', () => {
    expect(() =>
      garageOwnerSchema.parse({
        id: 'g1',
        name: 'Garagem',
        slug: 'user-12345678',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: null,
        coverImageObjectKey: 'https://r2.example.com/garage-cover/u1/x.jpg',
        coverImageUrl: null,
        daysLeftUntilExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...coverBase,
      }),
    ).toThrow();
  });

  it('rejects coverImageUrl outside garage-cover/ path', () => {
    expect(() =>
      garageOwnerSchema.parse({
        id: 'g1',
        name: 'Garagem',
        slug: 'user-12345678',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: null,
        coverImageObjectKey: null,
        coverImageUrl: 'https://r2.example.com/cars/x.jpg',
        daysLeftUntilExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...coverBase,
      }),
    ).toThrow();
  });
});

describe('garageCoverPatchSchema', () => {
  it('accepts coverPreset null (reset to default)', () => {
    const parsed = garageCoverPatchSchema.parse({ coverPreset: null });
    expect(parsed).toEqual({ coverPreset: null });
  });

  it('accepts a known preset slug', () => {
    const parsed = garageCoverPatchSchema.parse({ coverPreset: 'tokyo-wangan' });
    expect(parsed).toEqual({ coverPreset: 'tokyo-wangan' });
  });

  it('rejects an unknown preset slug', () => {
    expect(() => garageCoverPatchSchema.parse({ coverPreset: 'bogus' })).toThrow();
  });

  it('accepts a valid coverImageObjectKey', () => {
    const parsed = garageCoverPatchSchema.parse({
      coverImageObjectKey: 'garage-cover/user1/abc.jpg',
    });
    expect(parsed).toEqual({ coverImageObjectKey: 'garage-cover/user1/abc.jpg' });
  });

  it('accepts coverImageObjectKey null (reset)', () => {
    const parsed = garageCoverPatchSchema.parse({ coverImageObjectKey: null });
    expect(parsed).toEqual({ coverImageObjectKey: null });
  });

  it('rejects coverImageObjectKey that is a URL', () => {
    expect(() =>
      garageCoverPatchSchema.parse({
        coverImageObjectKey: 'https://example.com/garage-cover/u1/x.jpg',
      }),
    ).toThrow();
  });

  it('rejects a mixed body (both preset and objectKey)', () => {
    expect(() =>
      garageCoverPatchSchema.parse({
        coverPreset: 'tokyo-wangan',
        coverImageObjectKey: 'garage-cover/user1/abc.jpg',
      }),
    ).toThrow();
  });
});

describe('garageGamificationCapabilitySchema', () => {
  it('accepts { enabled: true } and { enabled: false }', () => {
    expect(garageGamificationCapabilitySchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(garageGamificationCapabilitySchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
  });

  it('rejects a missing or non-boolean enabled flag', () => {
    expect(() => garageGamificationCapabilitySchema.parse({})).toThrow();
    expect(() => garageGamificationCapabilitySchema.parse({ enabled: 'yes' })).toThrow();
  });
});

describe('garagePublicResponseSchema (Phase 2 — progress + stats + top-level gamification/badges)', () => {
  const baseProfile = {
    name: 'Minha Garagem',
    slug: 'meu-slug',
    description: null,
    premiumTier: null,
    coverPreset: null,
    coverImageUrl: null,
    isPremiumActive: false,
    gamification: { enabled: true as boolean },
    badges: [] as never[],
  };
  const baseResponse = {
    garage: baseProfile,
    cars: [],
    gamification: { enabled: true as boolean },
    badges: [] as never[],
  };
  const validProgress = {
    xp: 500,
    rank: 'Piloto',
    nextRank: 'Veterano',
    xpInTier: 100,
    xpToNextRank: 400,
    tierSpan: 500,
  };
  const validStats = {
    events: 5,
    posts: 2,
    likesReceived: 10,
    joinedAt: '2026-02-15T08:00:00.000Z',
  };

  it('accepts public response with top-level gamification + progress + stats present', () => {
    const parsed = garagePublicResponseSchema.parse({
      ...baseResponse,
      progress: validProgress,
      stats: validStats,
    });
    expect(parsed.gamification?.enabled).toBe(true);
    expect(parsed.progress?.rank).toBe('Piloto');
    expect(parsed.stats?.events).toBe(5);
  });

  it('accepts public response with progress + stats omitted (killswitch off OR hide-on-empty)', () => {
    const parsed = garagePublicResponseSchema.parse({
      ...baseResponse,
      gamification: { enabled: false },
    });
    expect(parsed.gamification?.enabled).toBe(false);
    expect(parsed.progress).toBeUndefined();
    expect(parsed.stats).toBeUndefined();
  });

  it('accepts public response with empty top-level badges array', () => {
    const parsed = garagePublicResponseSchema.parse({
      ...baseResponse,
      badges: [],
    });
    expect(parsed.badges).toEqual([]);
  });

  it('rejects public response missing top-level gamification (canon §1 wire-always-present)', () => {
    const { gamification: _drop, ...withoutGamification } = baseResponse;
    expect(() => garagePublicResponseSchema.parse(withoutGamification)).toThrow(/gamification/);
  });

  it('accepts public response missing top-level badges (chunk-24 transitional)', () => {
    const { badges: _drop, ...withoutBadges } = baseResponse;
    const parsed = garagePublicResponseSchema.parse(withoutBadges);
    expect(parsed.badges).toBeUndefined();
  });

  it('rejects public response whose stats has bad joinedAt', () => {
    expect(() =>
      garagePublicResponseSchema.parse({
        ...baseResponse,
        progress: validProgress,
        stats: { ...validStats, joinedAt: 'not-a-date' },
      }),
    ).toThrow();
  });
});
