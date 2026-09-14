import type { GarageProgress, GarageStats } from '@ccc/shared/garage-progress';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProfileStatsWeb, StatsRowWeb, XPScoreboardWeb } from '../index.js';

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

describe('ProfileStatsWeb', () => {
  it('renders XPScoreboard + StatsRow when gamificationEnabled + progress + stats present', () => {
    const html = renderToStaticMarkup(
      <ProfileStatsWeb gamificationEnabled progress={progress} stats={stats} />,
    );
    // XP value rendered (formatted to pt-BR: "1.234").
    expect(html).toContain('1.234');
    // Rank pill content present.
    expect(html).toContain('Veterano');
    // StatsRow tile labels present (uppercased).
    expect(html).toContain('EVENTOS');
    expect(html).toContain('POSTS');
    expect(html).toContain('CURTIDAS');
    expect(html).toContain('DESDE');
  });

  it('returns null when gamificationEnabled === false', () => {
    const html = renderToStaticMarkup(
      <ProfileStatsWeb gamificationEnabled={false} progress={progress} stats={stats} />,
    );
    expect(html).toBe('');
  });

  it('returns null when progress is undefined', () => {
    const html = renderToStaticMarkup(<ProfileStatsWeb gamificationEnabled stats={stats} />);
    expect(html).toBe('');
  });

  it('returns null when stats is undefined', () => {
    const html = renderToStaticMarkup(<ProfileStatsWeb gamificationEnabled progress={progress} />);
    expect(html).toBe('');
  });

  it('returns null when xp/events/posts/likesReceived are all zero', () => {
    const zeroProgress: GarageProgress = {
      xp: 0,
      rank: 'Iniciante',
      nextRank: 'Aprendiz',
      xpInTier: 0,
      xpToNextRank: 100,
      tierSpan: 100,
    };
    const zeroStats: GarageStats = {
      events: 0,
      posts: 0,
      likesReceived: 0,
      joinedAt: '2026-02-15T08:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <ProfileStatsWeb gamificationEnabled progress={zeroProgress} stats={zeroStats} />,
    );
    expect(html).toBe('');
  });
});

describe('XPScoreboardWeb', () => {
  it("renders '?' as a decorative <span>, not <button>", () => {
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    // The static hint carries no action, so it is hidden from the a11y tree
    // exactly like the RN twin's non-interactive fallback.
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>\?<\/span>/);
    expect(html).not.toContain('<button');
  });

  it("has no 'onclick' attribute in the rendered markup", () => {
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onClick');
  });

  it('caption is "Topo do ranking" when nextRank === null', () => {
    const top: GarageProgress = { ...progress, nextRank: null, xpToNextRank: 0, tierSpan: 1 };
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={top} />);
    expect(html).toContain('Topo do ranking');
  });

  it('caption is "<N> → <NextRank>" when nextRank is set', () => {
    // Mirrors the RN twin's caption verbatim, pt-BR thousands separator
    // included. The old "N XP até X" wording only existed on the web.
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html).toContain('3.766 → Lendário');
  });

  it('mirrors the mobile card material: #141414 sheet under a corner gold glow', () => {
    // Regression: the first web twin painted the WHOLE card in a solid brand
    // gradient. The app instead shows #141414 with gold burning in from the
    // top-left corner and gone by ~60% of the diagonal — sampled straight off
    // a device screenshot at (198,163,52) top-left, (20,20,20) right.
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html).toContain('background-color:#141414');
    expect(html).toContain('linear-gradient(105deg, #D4AF37 0%, rgba(212,175,55,0) 62%)');
  });

  it('keeps the 12% tint on the rank pill, where RN honours the alpha', () => {
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html).toContain('background-color:rgba(212,175,55,0.12)');
    expect(html).toContain('border-color:rgba(212,175,55,0.45)');
  });

  it('renders the 11 ticker hatches with every 5th tall', () => {
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html.match(/rounded-\[1px\]/g)).toHaveLength(11);
    expect(html.match(/height:8px/g)).toHaveLength(3);
    expect(html.match(/height:4px/g)).toHaveLength(8);
  });

  it('renders the rank pill and the "pontos" caption of the mobile layout', () => {
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html).toContain('pontos');
    expect(html).toContain('color:#E8C874');
  });

  it('progress bar forces 100% width at top tier (nextRank === null sentinel)', () => {
    // Top-tier sentinel: nextRank=null, tierSpan=1, xpInTier=0 at the
    // exact threshold. Mobile twin forces 100; web twin must mirror so
    // the bar does not collapse to 0% when a user just earned top rank.
    const top: GarageProgress = {
      ...progress,
      nextRank: null,
      xpToNextRank: 0,
      tierSpan: 1,
      xpInTier: 0,
    };
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={top} />);
    expect(html).toContain('width:100%');
  });

  it('does not reference unresolved CSS vars (--brand-*) in inline styles', () => {
    // Regression: admin globals.css defines --color-* tokens only.
    // Referencing --brand-deep / --brand / --brand-hot leaves gradients
    // unresolved in production. Inline hex from garageTokens.brand.* instead.
    const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
    expect(html).not.toContain('var(--brand');
  });
});

describe('StatsRowWeb', () => {
  it('formats joinedAt as "fev. 26" for an ISO datetime in Feb 2026', () => {
    const html = renderToStaticMarkup(<StatsRowWeb stats={stats} />);
    expect(html).toContain('fev. 26');
  });

  it('renders one decorative glyph per tile, matching the mobile icon set', () => {
    // The RN twin tops each tile with flag / post / fire / pin at 14px.
    // The web twin shipped without any glyph, which is the most visible
    // size-and-density difference between the two stats strips.
    const html = renderToStaticMarkup(<StatsRowWeb stats={stats} />);
    expect(html.match(/<svg/g)).toHaveLength(4);
    expect(html.match(/width="14"/g)).toHaveLength(4);
    expect(html.match(/<span aria-hidden="true"/g)).toHaveLength(4);
  });

  it('keeps all four labels', () => {
    const html = renderToStaticMarkup(<StatsRowWeb stats={stats} />);
    for (const label of ['EVENTOS', 'POSTS', 'CURTIDAS', 'DESDE']) {
      expect(html).toContain(label);
    }
  });
});
