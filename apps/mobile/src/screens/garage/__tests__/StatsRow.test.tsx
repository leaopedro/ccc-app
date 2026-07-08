// @vitest-environment jsdom
//
// StatsRow tests. The component lives in `packages/ui/src/StatsRow.tsx`, but
// tests live here so the mobile workspace's vitest picks them up — `@ccc/ui`
// has no test runner of its own (verified via packages/ui/package.json).
// Same mocking pattern as BadgeRow.test.tsx.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Mirror the Phase 1 reference `apps/mobile/src/screens/garage/__tests__/BadgeRow.test.tsx`
// RN mock block verbatim. Importing `@ccc/ui` also pulls in components that
// touch `ActivityIndicator`, `Image`, `Modal`, and `ScrollView` (BadgesSheet
// et al), so we MUST mock them here or the import-time evaluation crashes
// before any StatsRow assertion fires.
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
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
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
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void hitSlop;
      void numberOfLines;
      void source;
      void accessible;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ActivityIndicator: make('span'),
    Modal: make('div'),
    ScrollView: make('div'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

// `@ccc/ui` re-exports components that pull `react-native-svg` (HexBadge,
// BadgesSheet). The Phase 1 reference test mocks the same surface; copy it
// verbatim so importing `@ccc/ui` does not blow up at module-eval time.
vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { ...rest } = props;
      return ReactMod.createElement(tag, { ref, ...rest });
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
  // The four icons StatsRow uses go through `BadgeGlyph`'s ICON_MAP, which
  // imports MapPin / Flag / Flame / MessageSquare. Mirror BadgeRow.test.tsx
  // export list so the resolver does not blow up on unrelated lookups.
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

describe('formatJoinedAt', () => {
  it('formats a UTC ISO date to "<mês>. <YY>" PT-BR style', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    expect(formatJoinedAt('2026-02-14T00:00:00Z')).toBe('fev. 26');
  });

  it('always uses PT-BR regardless of host locale (no en-US fallback)', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    // March → "mar." in pt-BR; "Mar" in en-US. Assert PT-BR shape.
    expect(formatJoinedAt('2025-03-01T12:00:00Z')).toBe('mar. 25');
  });

  it('uses UTC so a midnight-UTC ISO never shifts month for east-of-UTC hosts', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    expect(formatJoinedAt('2026-02-01T00:00:00Z')).toBe('fev. 26');
  });

  it('returns "" for invalid input', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    expect(formatJoinedAt('not-a-date')).toBe('');
  });
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('StatsRow', () => {
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

  const STATS_NONZERO = {
    events: 7,
    posts: 12,
    likesReceived: 42,
    joinedAt: '2026-02-14T00:00:00Z',
  };

  const STATS_ZERO = {
    events: 0,
    posts: 0,
    likesReceived: 0,
    joinedAt: '2026-02-14T00:00:00Z',
  };

  it('renders 4 tiles in order: Eventos, Posts, Curtidas, Desde', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    const labels = Array.from(container.querySelectorAll('span'))
      .map((s) => s.textContent ?? '')
      .filter((t) => /^(EVENTOS|POSTS|CURTIDAS|DESDE)$/.test(t));
    expect(labels).toEqual(['EVENTOS', 'POSTS', 'CURTIDAS', 'DESDE']);
  });

  it('renders zero values as "0" (never blank, never "undefined")', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_ZERO} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('undefined');
    // The first three tiles must each render a literal "0" value.
    const zeros = Array.from(container.querySelectorAll('span')).filter(
      (s) => (s.textContent ?? '').trim() === '0',
    );
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it('renders numeric values raw with no thousand-separator (PT-BR `.` not inserted)', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(
      <StatsRow stats={{ ...STATS_NONZERO, events: 1234, posts: 5678, likesReceived: 9012 }} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('1234');
    expect(text).toContain('5678');
    expect(text).toContain('9012');
    expect(text).not.toContain('1.234');
    expect(text).not.toContain('5.678');
  });

  it('formats joinedAt to "fev. 26" PT-BR abbreviated month', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    expect(container.textContent ?? '').toContain('fev. 26');
  });

  it('uses PT-BR locale on the date tile (never en-US "Feb")', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    expect(container.textContent ?? '').not.toMatch(/Feb\b/);
  });

  it('renders one icon per tile (flag, post, fire, pin via BadgeGlyph)', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    const icons = Array.from(container.querySelectorAll('i[data-icon]')).map((n) =>
      n.getAttribute('data-icon'),
    );
    // ICON_MAP: flag → Flag, post → MessageSquare, fire → Flame, pin → MapPin.
    expect(icons).toEqual(['Flag', 'MessageSquare', 'Flame', 'MapPin']);
  });

  it('forwards testID to the outer container', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} testID="garage-stats-row" />);
    expect(container.querySelector('[data-testid="garage-stats-row"]')).not.toBeNull();
  });
});
