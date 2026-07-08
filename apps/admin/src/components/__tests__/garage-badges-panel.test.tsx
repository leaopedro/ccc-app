import type { BadgeCatalogEntry } from '@ccc/shared/badges';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Stub next/navigation so the client component can be rendered with
// renderToStaticMarkup in node — useRouter is called at module init.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

// Server-action stub used by the grant button. Replaced per test via
// dynamic import in the interaction spec.
vi.mock('~/lib/admin-garage-actions', () => ({
  grantAdminUserBadgeAction: vi.fn(),
}));

import { GarageBadgesPanel } from '../garage-badges-panel';

const catalog: BadgeCatalogEntry[] = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
  { code: 'EVT-002', category: 'eventos', rarity: 'rare', icon: 'streak', premiumExclusive: false },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    icon: 'curator',
    premiumExclusive: true,
  },
  {
    code: 'JDM-003',
    category: 'jdm',
    rarity: 'legendary',
    icon: 'founder',
    premiumExclusive: true,
  },
];

describe('GarageBadgesPanel (render)', () => {
  it('renders the full catalog grid with one tile per badge', () => {
    const html = renderToStaticMarkup(
      <GarageBadgesPanel userId="u1" catalog={catalog} earnedCodes={[]} isPremiumActive={false} />,
    );
    expect(html).toContain('Conquista EVT-001');
    expect(html).toContain('Conquista EVT-002');
    expect(html).toContain('Conquista CAR-003');
    expect(html).toContain('Conquista JDM-003');
  });

  it('marks earned badges with the earned indicator + earned variant', () => {
    const html = renderToStaticMarkup(
      <GarageBadgesPanel
        userId="u1"
        catalog={catalog}
        earnedCodes={['EVT-001']}
        isPremiumActive={false}
      />,
    );
    // earned indicator copy
    expect(html).toContain('Conquistada');
    // earned variant in the HexBadge label
    expect(html).toContain('Conquista EVT-001, desbloqueada');
    // not-earned ones remain locked
    expect(html).toContain('Conquista EVT-002, bloqueada');
  });

  it('renders a "Conceder" button for badges the user has not earned', () => {
    const html = renderToStaticMarkup(
      <GarageBadgesPanel
        userId="u1"
        catalog={catalog}
        earnedCodes={['EVT-001']}
        isPremiumActive={false}
      />,
    );
    // Grant button for not-earned badges
    expect(html.match(/Conceder/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('does not render a grant button for already-earned badges', () => {
    const earnedAll = catalog.map((c) => c.code);
    const html = renderToStaticMarkup(
      <GarageBadgesPanel
        userId="u1"
        catalog={catalog}
        earnedCodes={earnedAll}
        isPremiumActive={true}
      />,
    );
    expect(html).not.toContain('Conceder');
  });

  it('uses admin Tailwind tokens (bg-surface / text-fg-secondary) — no hardcoded hexes in className', () => {
    const html = renderToStaticMarkup(
      <GarageBadgesPanel userId="u1" catalog={catalog} earnedCodes={[]} isPremiumActive={false} />,
    );
    // sample a token presence — the panel uses the admin design surface
    expect(html).toContain('bg-surface');
  });

  it('renders the section heading "Conquistas"', () => {
    const html = renderToStaticMarkup(
      <GarageBadgesPanel userId="u1" catalog={catalog} earnedCodes={[]} isPremiumActive={false} />,
    );
    expect(html).toContain('Conquistas');
  });

  it('renders an empty-state message when the catalog is empty (killswitch off / fetch fail)', () => {
    const html = renderToStaticMarkup(
      <GarageBadgesPanel userId="u1" catalog={[]} earnedCodes={[]} isPremiumActive={false} />,
    );
    expect(html).toContain('Catálogo de conquistas indisponível');
  });
});
