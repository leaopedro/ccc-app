import { describe, expect, it } from 'vitest';

import {
  badgeCatalogEntrySchema,
  badgeCodeSchema,
  badgeCategorySchema,
  badgeRaritySchema,
  garageBadgeOwnerStateSchema,
  garageBadgePublicSchema,
  garageBadgesPublicPayloadSchema,
} from '../badges.js';

describe('badgeCodeSchema', () => {
  it('accepts canonical catalog codes', () => {
    for (const code of ['EVT-001', 'CAR-002', 'COM-003', 'CCC-001']) {
      expect(badgeCodeSchema.parse(code)).toBe(code);
    }
  });

  it('rejects lowercase / wrong shape', () => {
    expect(() => badgeCodeSchema.parse('evt-001')).toThrow();
    expect(() => badgeCodeSchema.parse('evt-1')).toThrow();
    expect(() => badgeCodeSchema.parse('EVT001')).toThrow();
    expect(() => badgeCodeSchema.parse('EVT-1234')).toThrow();
    expect(() => badgeCodeSchema.parse('EV-001')).toThrow();
  });
});

describe('badge category + rarity enums', () => {
  it('accepts every declared category', () => {
    for (const c of ['eventos', 'carros', 'comunidade', 'ccc']) {
      expect(badgeCategorySchema.parse(c)).toBe(c);
    }
  });

  it('accepts every declared rarity', () => {
    for (const r of ['common', 'rare', 'legendary']) {
      expect(badgeRaritySchema.parse(r)).toBe(r);
    }
  });

  it('rejects unknown category / rarity values', () => {
    expect(() => badgeCategorySchema.parse('eventoz')).toThrow();
    expect(() => badgeRaritySchema.parse('epic')).toThrow();
  });
});

describe('badgeCatalogEntrySchema', () => {
  it('round-trips a valid catalog row', () => {
    const entry = {
      code: 'EVT-001',
      category: 'eventos' as const,
      rarity: 'common' as const,
      premiumExclusive: false,
      icon: 'flag',
    };
    expect(badgeCatalogEntrySchema.parse(entry)).toEqual(entry);
  });
});

describe('garageBadgeOwnerStateSchema', () => {
  it('parses earned state', () => {
    const parsed = garageBadgeOwnerStateSchema.parse({
      code: 'EVT-001',
      state: 'earned',
      earnedAt: '2026-05-22T12:00:00.000Z',
      pinned: true,
      pinnedAt: '2026-05-22T12:30:00.000Z',
    });
    expect(parsed.state).toBe('earned');
  });

  it('parses locked state', () => {
    const parsed = garageBadgeOwnerStateSchema.parse({ code: 'EVT-001', state: 'locked' });
    expect(parsed.state).toBe('locked');
  });

  it('parses locked_premium state', () => {
    const parsed = garageBadgeOwnerStateSchema.parse({
      code: 'EVT-001',
      state: 'locked_premium',
    });
    expect(parsed.state).toBe('locked_premium');
  });
});

describe('garageBadgePublicSchema', () => {
  it('accepts pinned earned public payload', () => {
    const parsed = garageBadgePublicSchema.parse({
      code: 'CCC-003',
      earnedAt: '2026-05-22T12:00:00.000Z',
    });
    expect(parsed.code).toBe('CCC-003');
  });
});

describe('garageBadgesPublicPayloadSchema', () => {
  it('parses an empty array', () => {
    expect(garageBadgesPublicPayloadSchema.parse([])).toEqual([]);
  });

  it('parses a list of pinned earned entries', () => {
    const payload = [
      { code: 'EVT-001', earnedAt: '2026-05-22T12:00:00.000Z' },
      { code: 'CCC-003', earnedAt: '2026-04-01T09:00:00.000Z' },
    ];
    expect(garageBadgesPublicPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects entries with an invalid code', () => {
    expect(() =>
      garageBadgesPublicPayloadSchema.parse([
        { code: 'evt-001', earnedAt: '2026-05-22T12:00:00.000Z' },
      ]),
    ).toThrow();
  });
});
