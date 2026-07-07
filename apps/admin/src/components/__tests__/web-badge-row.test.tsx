import type { BadgeCatalogEntry, GarageBadgePublic } from '@jdm/shared/badges';
import { BadgeRow } from '@jdm/ui/web';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// BadgeRow web twin spec. Reads the public payload shape
// (`GarageBadgePublic[]` = pinned earned only — chunk 16) + a catalog
// for icon/rarity resolution. SSR-safe: no event handlers, no
// `'use client'`.

const catalog: BadgeCatalogEntry[] = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
  {
    code: 'EVT-002',
    category: 'eventos',
    rarity: 'rare',
    icon: 'streak',
    premiumExclusive: false,
  },
  {
    code: 'EVT-003',
    category: 'eventos',
    rarity: 'legendary',
    icon: 'medal',
    premiumExclusive: false,
  },
  { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car', premiumExclusive: false },
  {
    code: 'CAR-002',
    category: 'carros',
    rarity: 'rare',
    icon: 'garageFull',
    premiumExclusive: false,
  },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    icon: 'curator',
    premiumExclusive: false,
  },
];

const earnedAt = '2026-05-01T12:00:00.000Z';

describe('BadgeRow (web, SSR)', () => {
  it('renders nothing when no badges are pinned', () => {
    const html = renderToStaticMarkup(<BadgeRow badges={[]} catalog={catalog} />);
    expect(html).toBe('');
  });

  it('renders up to 4 badge tiles when 4 or fewer are pinned', () => {
    const badges: GarageBadgePublic[] = [
      { code: 'EVT-001', earnedAt },
      { code: 'CAR-001', earnedAt },
    ];
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    // Both labels should appear via aria-label.
    expect(html).toContain('Conquista EVT-001');
    expect(html).toContain('Conquista CAR-001');
    expect(html).not.toContain('+');
  });

  it('renders the "Conquistas" section header + counter (pinned-only count)', () => {
    const badges: GarageBadgePublic[] = [{ code: 'EVT-001', earnedAt }];
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    expect(html).toContain('Conquistas');
  });

  it('renders +N overflow chip when more than 4 badges are pinned', () => {
    const badges: GarageBadgePublic[] = [
      { code: 'EVT-001', earnedAt },
      { code: 'EVT-002', earnedAt },
      { code: 'EVT-003', earnedAt },
      { code: 'CAR-001', earnedAt },
      { code: 'CAR-002', earnedAt },
      { code: 'CAR-003', earnedAt },
    ];
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    // First 4 should appear, last 2 collapse into a +2 chip.
    expect(html).toContain('Conquista EVT-001');
    expect(html).toContain('Conquista EVT-002');
    expect(html).toContain('Conquista EVT-003');
    expect(html).toContain('Conquista CAR-001');
    expect(html).toContain('+2');
    expect(html).not.toContain('Conquista CAR-002');
  });

  it('skips badges whose code is not in the catalog (catalog drift)', () => {
    const badges: GarageBadgePublic[] = [
      { code: 'EVT-001', earnedAt },
      // Hypothetical code added after this client built — skip it.
      { code: 'XXX-999' as GarageBadgePublic['code'], earnedAt },
    ];
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    expect(html).toContain('Conquista EVT-001');
    expect(html).not.toContain('Conquista XXX-999');
  });

  it('uses the catalog rarity to color each tile (legendary tile renders brand gold)', () => {
    const badges: GarageBadgePublic[] = [{ code: 'EVT-003', earnedAt }];
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    expect(html.toUpperCase()).toContain('#D4AF37');
  });

  it('renders no interactive elements (SSR-static — pinned-only public display)', () => {
    const badges: GarageBadgePublic[] = [{ code: 'EVT-001', earnedAt }];
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('onClick');
  });

  it('overflow chip uses inline borderColor — no border-border in className', () => {
    const badges: GarageBadgePublic[] = ['EVT-001', 'EVT-002', 'EVT-003', 'CAR-001', 'CAR-002'].map(
      (code) => ({ code, earnedAt }),
    );
    const html = renderToStaticMarkup(<BadgeRow badges={badges} catalog={catalog} />);
    const chip = /aria-label="Mais 1 conquistas"[^>]*/.exec(html)?.[0] ?? '';
    expect(chip).toContain('border-dashed');
    expect(chip).not.toContain('border-border');
  });
});
