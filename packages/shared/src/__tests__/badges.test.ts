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

import {
  badgeCelebrationsAckRequestSchema,
  badgeCelebrationsResponseSchema,
  CELEBRATION_PAGE_SIZE,
  CELEBRATION_WINDOW_DAYS,
} from '../badges.js';
import { pushKindSchema } from '../push.js';
import { badgeAwardedGroupBody } from '../badges-copy.js';

describe('celebrações', () => {
  it('aceita uma resposta de pendentes', () => {
    const parsed = badgeCelebrationsResponseSchema.parse({
      enabled: true,
      pending: [{ code: 'EVT-001', earnedAt: '2026-09-13T12:00:00.000Z' }],
    });
    expect(parsed.pending[0]!.code).toBe('EVT-001');
  });

  it('recusa código fora do formato de wire', () => {
    expect(() =>
      badgeCelebrationsResponseSchema.parse({
        enabled: true,
        pending: [{ code: 'evt-1', earnedAt: '2026-09-13T12:00:00.000Z' }],
      }),
    ).toThrow();
  });

  it('limita o ack ao tamanho da página e recusa lista vazia', () => {
    expect(() => badgeCelebrationsAckRequestSchema.parse({ codes: [] })).toThrow();
    const tooMany = Array.from({ length: CELEBRATION_PAGE_SIZE + 1 }, () => 'EVT-001');
    expect(() => badgeCelebrationsAckRequestSchema.parse({ codes: tooMany })).toThrow();
    expect(badgeCelebrationsAckRequestSchema.parse({ codes: ['EVT-001'] }).codes).toHaveLength(1);
  });

  it('fixa a janela em 7 dias', () => {
    expect(CELEBRATION_WINDOW_DAYS).toBe(7);
  });

  it('aceita badge_awarded como kind de push', () => {
    expect(pushKindSchema.parse('badge_awarded')).toBe('badge_awarded');
  });

  it('pluraliza o corpo do push agrupado', () => {
    expect(badgeAwardedGroupBody(3)).toBe('Você ganhou 3 conquistas.');
  });
});
