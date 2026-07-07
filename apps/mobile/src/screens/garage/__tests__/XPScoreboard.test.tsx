// @vitest-environment jsdom
//
// XPScoreboard tests. Component lives in `packages/ui/src/`; tests live
// here because `@jdm/ui` has no test runner of its own. Mirrors
// HexBadge.test.tsx / BadgeRow.test.tsx / BadgeDetail.test.tsx.
//
// react-native + react-native-svg + lucide-react-native are stubbed to inert
// jsdom-friendly tags. The svg mock forwards `style` as
// `data-style={JSON.stringify(style)}` so progress-bar specs can assert the
// `width: "${pct}%"` inline style without a full RN renderer. The component
// uses react-native-svg gradients (not expo-linear-gradient) so `@jdm/ui` has
// no extra runtime dep — canon §15.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityHint,
        accessibilityRole,
        accessibilityState,
        accessibilityElementsHidden,
        importantForAccessibility,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
        pointerEvents,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      const disabledFlag =
        accessibilityState &&
        typeof accessibilityState === 'object' &&
        (accessibilityState as { disabled?: boolean }).disabled === true;
      if (disabledFlag) aria['aria-disabled'] = 'true';
      if (accessibilityElementsHidden === true) aria['aria-hidden'] = 'true';
      if (typeof importantForAccessibility === 'string') {
        aria['data-important-for-accessibility'] = importantForAccessibility;
      }
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      if (style && typeof style === 'object') aria['data-style'] = JSON.stringify(style);
      void hitSlop;
      void numberOfLines;
      void source;
      void accessible;
      void pointerEvents;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ActivityIndicator: make('span'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { style, ...rest } = props;
      const aria: Record<string, unknown> = {};
      if (style && typeof style === 'object') aria['data-style'] = JSON.stringify(style);
      return ReactMod.createElement(tag, { ref, ...rest, ...aria });
    });
  return {
    default: make('svg'),
    Svg: make('svg'),
    Defs: make('defs'),
    Pattern: make('pattern'),
    Rect: make('rect'),
    Line: make('line'),
    G: make('g'),
    Polygon: make('polygon'),
    Path: make('path'),
    LinearGradient: make('lineargradient'),
    Stop: make('stop'),
  };
});

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const make = (label: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { color, size, strokeWidth, ...rest } = props;
      void color;
      void size;
      void strokeWidth;
      return ReactMod.createElement('i', { ref, 'data-icon': label, ...rest });
    });
  // Mirrors the surface needed by `@jdm/ui` barrel imports (BadgeGlyph
  // ICON_MAP). Keep in sync with packages/ui/src/BadgeGlyph.tsx.
  return {
    Car: make('Car'),
    CheckSquare: make('CheckSquare'),
    Crown: make('Crown'),
    Flag: make('Flag'),
    Flame: make('Flame'),
    Heart: make('Heart'),
    HelpCircle: make('HelpCircle'),
    Home: make('Home'),
    Library: make('Library'),
    Lock: make('Lock'),
    MapPin: make('MapPin'),
    Medal: make('Medal'),
    MessageCircle: make('MessageCircle'),
    MessageSquare: make('MessageSquare'),
    ShieldCheck: make('ShieldCheck'),
    TrendingUp: make('TrendingUp'),
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const PROGRESS_MID = {
  xp: 1247,
  rank: 'Veterano',
  nextRank: 'Lendário',
  xpInTier: 747,
  xpToNextRank: 753,
  tierSpan: 1500,
} as const;

const PROGRESS_TOP = {
  xp: 50000,
  rank: 'Hall of Fame',
  nextRank: null,
  xpInTier: 45000,
  xpToNextRank: 0,
  tierSpan: 1,
} as const;

describe('XPScoreboard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderEl = async (el: React.ReactElement) => {
    await act(async () => {
      root.render(el);
      await flush();
    });
  };

  it('renders the XP number formatted pt-BR and the current rank pill', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} onPressHint={() => {}} />);
    expect(container.textContent ?? '').toContain('1.247');
    expect(container.textContent ?? '').toContain('Veterano');
  });

  it('renders the next-rank caption when not at the top tier', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} onPressHint={() => {}} />);
    expect(container.textContent ?? '').toContain('753');
    expect(container.textContent ?? '').toContain('Lendário');
    expect(container.textContent ?? '').not.toContain('Topo do ranking');
  });

  it('renders "Topo do ranking" caption when nextRank === null', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_TOP} onPressHint={() => {}} />);
    expect(container.textContent ?? '').toContain('Topo do ranking');
    expect(container.textContent ?? '').not.toContain(' → ');
  });

  it('progress bar width = round(xpInTier / tierSpan * 100) and clamps to 100 at top tier', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} onPressHint={() => {}} />);
    const midSvgs = Array.from(container.querySelectorAll('svg[data-style]'));
    const midFill = midSvgs
      .map((g) => g.getAttribute('data-style') ?? '')
      .find((s) => s.includes('"width":"50%"'));
    expect(midFill).toBeDefined();

    await renderEl(<XPScoreboard progress={PROGRESS_TOP} onPressHint={() => {}} />);
    const topSvgs = Array.from(container.querySelectorAll('svg[data-style]'));
    const topFill = topSvgs
      .map((g) => g.getAttribute('data-style') ?? '')
      .find((s) => s.includes('"width":"100%"'));
    expect(topFill).toBeDefined();
  });

  it('calls onPressHint when the `?` button is pressed', async () => {
    const fn = vi.fn();
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} onPressHint={fn} />);
    const btn = container.querySelector('button[data-testid="xp-scoreboard-hint"]');
    if (!(btn instanceof HTMLButtonElement)) throw new Error('hint button not rendered');
    await act(async () => {
      btn.click();
      await flush();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not crash when tierSpan === 1 and xpToNextRank === 0 (top-tier sentinel)', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_TOP} onPressHint={() => {}} />);
    expect(container.textContent ?? '').toContain('Hall of Fame');
  });

  it('applies textShadow* style props to the Anton 46px XP number', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} onPressHint={() => {}} />);
    const xpSpan = container.querySelector('span[aria-label="1.247 XP"]');
    if (!(xpSpan instanceof HTMLElement)) throw new Error('XP number text node not rendered');
    const style = xpSpan.getAttribute('data-style') ?? '';
    expect(style).toContain('"fontFamily":"Jost_300Regular"');
    expect(style).toContain('"fontSize":46');
    expect(style).toContain('"textShadowColor":"rgba(212,175,55,0.18)"');
    expect(style).toContain('"textShadowRadius":24');
  });

  it('renders 11 ticker hatches with every 5th tall (8px) and others short (4px)', async () => {
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} onPressHint={() => {}} />);
    const allDivs = Array.from(container.querySelectorAll('div[data-style]'));
    const ticks = allDivs.filter((d) => {
      const s = d.getAttribute('data-style') ?? '';
      return s.includes('"width":1') && (s.includes('"height":4') || s.includes('"height":8'));
    });
    expect(ticks).toHaveLength(11);
    const tall = ticks.filter((d) => (d.getAttribute('data-style') ?? '').includes('"height":8'));
    expect(tall).toHaveLength(3);
  });

  it('renders a static "?" with no button + no handler when onPressHint is undefined (SSR variant)', async () => {
    // Canon §12 — SSR composition (chunk 41 ProfileStatsWeb) passes undefined
    // so the `?` degrades to a non-interactive element. The mobile twin must
    // honour the same contract: no Pressable (no <button> after the RN mock),
    // no `xp-scoreboard-hint` testID, the `?` glyph still renders, and the
    // wrapper carries the RN accessibility-hidden attributes so screen readers
    // do not announce a bare "?" with no associated action.
    const { XPScoreboard } = await import('@jdm/ui');
    await renderEl(<XPScoreboard progress={PROGRESS_MID} />);
    expect(container.textContent ?? '').toContain('?');
    expect(container.querySelector('button[data-testid="xp-scoreboard-hint"]')).toBeNull();
    expect(container.querySelector('[data-testid="xp-scoreboard-hint"]')).toBeNull();
    // No onClick wiring leaks into the static element.
    const anyButton = container.querySelector('button');
    expect(anyButton).toBeNull();
    // Accessibility-hidden semantics: the RN mock converts
    // `accessibilityElementsHidden` to `aria-hidden="true"` and forwards
    // `importantForAccessibility` as a data attribute.
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.getAttribute('data-important-for-accessibility')).toBe('no-hide-descendants');
  });
});
