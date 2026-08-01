import type { BadgeCatalogEntry } from '@ccc/shared/badges';
import type { GarageProgress, GarageStats } from '@ccc/shared/garage-progress';
import type { GaragePublicResponse } from '@ccc/shared/garage-public';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PublicGarageNotFound from '../../../app/g/[slug]/not-found';
import { PublicGarageView } from '../public-garage-view';

type Garage = GaragePublicResponse['garage'];
type Car = GaragePublicResponse['cars'][number];

const baseGarage: Garage = {
  name: 'Quintal do JDM',
  slug: 'quintal-do-jdm',
  description: null,
  premiumTier: 'gold',
  coverPreset: null,
  coverImageUrl: null,
  isPremiumActive: false,
  gamification: { enabled: true },
  badges: [],
};

const progress: GarageProgress = {
  xp: 1234,
  rank: 'Veterano',
  nextRank: 'Lendário',
  xpInTier: 234,
  xpToNextRank: 3766,
  tierSpan: 4000,
};

const stats: GarageStats = {
  events: 12,
  posts: 4,
  likesReceived: 88,
  joinedAt: '2026-02-15T08:00:00.000Z',
};

const carWithoutPhoto: Car = {
  id: 'car-1',
  make: 'Nissan',
  model: 'Skyline',
  year: 1999,
  nickname: 'Godzilla',
  modifications: [],
  photos: [],
};

const carWithPhoto: Car = {
  ...carWithoutPhoto,
  id: 'car-2',
  photos: [{ id: 'photo-1', url: 'https://cdn.example/car-2.jpg', width: 1200, height: 800 }],
};

describe('PublicGarageView', () => {
  it('renders a custom cover <img> when premium is active and coverImageUrl is set', () => {
    const garage: Garage = {
      ...baseGarage,
      coverImageUrl: 'https://cdn.example/custom.jpg',
      coverPreset: 'tokyo-wangan',
      isPremiumActive: true,
    };
    const html = renderToStaticMarkup(<PublicGarageView garage={garage} cars={[]} />);
    expect(html).toContain('<img src="https://cdn.example/custom.jpg"');
  });

  it('renders the tokyo-wangan gradient when premium is active without a custom URL', () => {
    const garage: Garage = {
      ...baseGarage,
      coverPreset: 'tokyo-wangan',
      isPremiumActive: true,
    };
    const html = renderToStaticMarkup(<PublicGarageView garage={garage} cars={[]} />);
    expect(html.toLowerCase()).toContain('#1a0606');
  });

  describe('preset R2 image overlay', () => {
    const prev = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
    beforeEach(() => {
      process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = 'https://r2.test';
    });
    afterEach(() => {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
      else process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = prev;
    });

    it('renders the preset R2 <img> over the gradient when NEXT_PUBLIC_R2_PUBLIC_BASE_URL is set', () => {
      const garage: Garage = {
        ...baseGarage,
        coverPreset: 'autobahn-blue',
        isPremiumActive: true,
      };
      const html = renderToStaticMarkup(<PublicGarageView garage={garage} cars={[]} />);
      expect(html).toContain(
        '<img src="https://r2.test/garage-cover-presets/autobahn-blue@2x.jpg"',
      );
      expect(html.toLowerCase()).toContain('#0d1e3a');
    });
  });

  it('downgrades to default-door gradient when premium is inactive (lapsed) even if coverPreset is set', () => {
    const garage: Garage = {
      ...baseGarage,
      coverPreset: 'tokyo-wangan',
      coverImageUrl: 'https://cdn.example/should-not-render.jpg',
      isPremiumActive: false,
    };
    const html = renderToStaticMarkup(<PublicGarageView garage={garage} cars={[]} />);
    expect(html.toLowerCase()).toContain('#1f1f1f');
    expect(html).not.toContain('#1A0606');
    expect(html).not.toContain('https://cdn.example/should-not-render.jpg');
  });

  it('renders the empty-state copy when there are no cars', () => {
    const html = renderToStaticMarkup(<PublicGarageView garage={baseGarage} cars={[]} />);
    expect(html).toContain('Nenhum carro publicado');
  });

  it('renders <img> for a car with a photo and shows year/make/model + nickname', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView garage={baseGarage} cars={[carWithPhoto]} />,
    );
    expect(html).toContain('<img src="https://cdn.example/car-2.jpg"');
    expect(html).toContain('1999 Nissan Skyline');
    expect(html).toContain('Godzilla');
  });

  it('falls back to placeholder div for a car without photos', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView garage={baseGarage} cars={[carWithoutPhoto]} />,
    );
    expect(html).not.toContain('<img src="https://cdn.example/car-2.jpg"');
    expect(html).toContain('bg-surface-deep');
  });
});

describe('PublicGarageView — Conquistas (chunk 21)', () => {
  const catalog: BadgeCatalogEntry[] = [
    {
      code: 'EVT-001',
      category: 'eventos',
      rarity: 'common',
      icon: 'flag',
      premiumExclusive: false,
    },
    {
      code: 'CCC-003',
      category: 'ccc',
      rarity: 'legendary',
      icon: 'founder',
      premiumExclusive: false,
    },
  ];
  const earnedAt = '2026-05-01T12:00:00.000Z';

  it('renders the Conquistas BadgeRow when the public payload has pinned badges + catalog is provided', () => {
    const garage: Garage = {
      ...baseGarage,
      badges: [{ code: 'CCC-003', earnedAt }],
    };
    const html = renderToStaticMarkup(
      <PublicGarageView garage={garage} cars={[]} badgeCatalog={catalog} />,
    );
    expect(html).toContain('Conquistas');
    expect(html).toContain('Conquista CCC-003');
  });

  it('omits the BadgeRow when the garage has no pinned badges', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView garage={baseGarage} cars={[]} badgeCatalog={catalog} />,
    );
    expect(html).not.toContain('Conquista ');
  });

  it('omits the BadgeRow when the catalog fetch failed (empty catalog)', () => {
    const garage: Garage = {
      ...baseGarage,
      badges: [{ code: 'CCC-003', earnedAt }],
    };
    const html = renderToStaticMarkup(
      <PublicGarageView garage={garage} cars={[]} badgeCatalog={[]} />,
    );
    expect(html).not.toContain('Conquista ');
  });

  it('omits the BadgeRow when gamification is disabled (killswitch off)', () => {
    const garage: Garage = {
      ...baseGarage,
      gamification: { enabled: false },
      badges: [{ code: 'CCC-003', earnedAt }],
    };
    const html = renderToStaticMarkup(
      <PublicGarageView garage={garage} cars={[]} badgeCatalog={catalog} />,
    );
    expect(html).not.toContain('Conquista ');
  });
});

describe('PublicGarageView — ProfileStats (chunk 41)', () => {
  const catalog: BadgeCatalogEntry[] = [
    {
      code: 'CCC-003',
      category: 'ccc',
      rarity: 'legendary',
      icon: 'founder',
      premiumExclusive: false,
    },
  ];

  it('renders ProfileStats when progress + stats present and gamificationEnabled === true', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView
        garage={baseGarage}
        cars={[]}
        gamificationEnabled
        progress={progress}
        stats={stats}
      />,
    );
    expect(html).toContain('Veterano');
    expect(html).toContain('EVENTOS');
    expect(html).toContain('fev. 26');
  });

  it('omits ProfileStats when progress is undefined', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView garage={baseGarage} cars={[]} gamificationEnabled stats={stats} />,
    );
    expect(html).not.toContain('Veterano');
    expect(html).not.toContain('EVENTOS');
  });

  it('omits ProfileStats when stats is undefined', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView garage={baseGarage} cars={[]} gamificationEnabled progress={progress} />,
    );
    expect(html).not.toContain('Veterano');
    expect(html).not.toContain('EVENTOS');
  });

  it('omits ProfileStats when gamificationEnabled === false (response top-level flag)', () => {
    const html = renderToStaticMarkup(
      <PublicGarageView
        garage={baseGarage}
        cars={[]}
        gamificationEnabled={false}
        progress={progress}
        stats={stats}
      />,
    );
    expect(html).not.toContain('Veterano');
    expect(html).not.toContain('EVENTOS');
  });

  it("renders the static '?' as inert (no onclick) inside the composed page", () => {
    const html = renderToStaticMarkup(
      <PublicGarageView
        garage={baseGarage}
        cars={[]}
        gamificationEnabled
        progress={progress}
        stats={stats}
      />,
    );
    expect(html).toMatch(/<span[^>]*aria-label="Sobre XP"/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Sobre XP"/);
    expect(html).not.toContain('onclick');
  });

  it('inserts ProfileStats between the identity section and the BadgeRow when both render', () => {
    const earnedAt = '2026-05-01T12:00:00.000Z';
    const garage: Garage = {
      ...baseGarage,
      badges: [{ code: 'CCC-003', earnedAt }],
    };
    const html = renderToStaticMarkup(
      <PublicGarageView
        garage={garage}
        cars={[]}
        gamificationEnabled
        progress={progress}
        stats={stats}
        badgeCatalog={catalog}
      />,
    );
    const idxSlug = html.indexOf(`casacarclub.com.br/g/${garage.slug}`);
    const idxScoreboard = html.indexOf('Veterano');
    const idxBadgeRow = html.indexOf('Conquista CCC-003');
    expect(idxSlug).toBeGreaterThan(-1);
    expect(idxScoreboard).toBeGreaterThan(idxSlug);
    expect(idxBadgeRow).toBeGreaterThan(idxScoreboard);
  });

  it('produces byte-stable HTML for identical input (same input → same bytes)', () => {
    const a = renderToStaticMarkup(
      <PublicGarageView
        garage={baseGarage}
        cars={[]}
        gamificationEnabled
        progress={progress}
        stats={stats}
      />,
    );
    const b = renderToStaticMarkup(
      <PublicGarageView
        garage={baseGarage}
        cars={[]}
        gamificationEnabled
        progress={progress}
        stats={stats}
      />,
    );
    expect(a).toBe(b);
  });
});

describe('PublicGarageNotFound (anti-enumeration)', () => {
  it('produces byte-identical markup across renders (same render for unknown and private slugs)', () => {
    const a = renderToStaticMarkup(<PublicGarageNotFound />);
    const b = renderToStaticMarkup(<PublicGarageNotFound />);
    expect(a).toBe(b);
  });

  it('renders the locked HTTP 404 stamp + Portuguese heading', () => {
    const html = renderToStaticMarkup(<PublicGarageNotFound />);
    expect(html).toContain('Garagem não encontrada');
    expect(html).toContain('HTTP 404');
  });
});
