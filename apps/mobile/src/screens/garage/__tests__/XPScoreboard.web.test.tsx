// @vitest-environment jsdom
//
// XPScoreboard SSR (web twin) tests. The web twin lives at
// `packages/ui/src/web/XPScoreboard.tsx` and is rendered server-side by the
// public profile page (chunk 41). These specs exercise the twin through
// `react-dom/server`'s `renderToString` so the SSR contract is asserted
// directly, not via the mobile RN-mock shim.

import type { GarageProgress } from '@jdm/shared/garage-progress';
import { XPScoreboard, type XPScoreboardProps } from '@jdm/ui/web';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const PROGRESS_MID: GarageProgress = {
  xp: 1247,
  rank: 'Aprendiz',
  nextRank: 'Mecânico',
  xpInTier: 747,
  tierSpan: 1500,
  xpToNextRank: 753,
};

const PROGRESS_TOP: GarageProgress = {
  xp: 12345,
  rank: 'Hall of Fame',
  nextRank: null,
  xpInTier: 5000,
  tierSpan: 1,
  xpToNextRank: 0,
};

const renderSSR = (props: XPScoreboardProps): string => renderToString(<XPScoreboard {...props} />);

describe('XPScoreboard (web SSR twin)', () => {
  it('renders the XP number, rank pill, and caption (mid-tier)', () => {
    const html = renderSSR({ progress: PROGRESS_MID, onPressHint: () => {} });
    expect(html).toContain('1.247');
    expect(html).toContain('Aprendiz');
    expect(html).toContain('Mecânico');
    expect(html).toContain('753');
  });

  it('renders "Topo do ranking" + forces 100% bar at top tier (§C14)', () => {
    const html = renderSSR({ progress: PROGRESS_TOP });
    expect(html).toContain('Topo do ranking');
    // Top-tier sentinel forces pct to 100 before division — bar fill style
    // sits inline on the inner gradient element.
    expect(html).toMatch(/width:\s*100%/);
    expect(html).not.toContain('→');
  });

  it('renders an interactive <button> when onPressHint is provided (canon §12 mobile composition)', () => {
    const html = renderSSR({ progress: PROGRESS_MID, onPressHint: () => {} });
    expect(html).toMatch(/<button\b[^>]*data-testid="xp-scoreboard-hint"/);
    expect(html).toMatch(/aria-label="Como ganhar XP"/);
  });

  it('renders a static <span aria-hidden> when onPressHint is undefined (canon §12 SSR composition)', () => {
    const html = renderSSR({ progress: PROGRESS_MID });
    // No interactive node — SSR composition omits the opener so there is
    // no modal to trigger.
    expect(html).not.toMatch(/<button\b/);
    expect(html).not.toContain('xp-scoreboard-hint');
    // Static `?` glyph still renders, hidden from accessibility.
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>\?<\/span>/);
  });

  it('renders the rank label twice (pill + caption row) for both tiers', () => {
    const midHtml = renderSSR({ progress: PROGRESS_MID });
    const matches = midHtml.match(/Aprendiz/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const topHtml = renderSSR({ progress: PROGRESS_TOP });
    const topMatches = topHtml.match(/Hall of Fame/g) ?? [];
    expect(topMatches.length).toBeGreaterThanOrEqual(1);
  });
});
