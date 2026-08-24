// @vitest-environment jsdom
//
// ClubStatsSection é puramente visual, então além do texto pinamos o layout
// do grid do handoff via o mesmo mecanismo `data-style` de
// src/screens/inicio/components/__tests__/primitives.test.tsx: o mock de
// `react-native` grava o style resolvido num atributo sintético que os
// testes leem com JSON.parse.

import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { ClubStatsSection } from '../ClubStatsSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const resolveStyle = (style: unknown): Record<string, unknown> | undefined => {
  const resolved =
    typeof style === 'function' ? (style as (s: unknown) => unknown)({ pressed: false }) : style;
  if (Array.isArray(resolved)) {
    return resolved.reduce<Record<string, unknown>>(
      (acc, entry) => (entry ? { ...acc, ...(entry as Record<string, unknown>) } : acc),
      {},
    );
  }
  return resolved as Record<string, unknown> | undefined;
};

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityRole,
        testID,
        onPress,
        hitSlop,
        pointerEvents,
        resizeMode,
        source,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      void className;
      void hitSlop;
      void pointerEvents;
      void resizeMode;
      void source;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

const STATS: ClubStatsResponse = { members: 128, events: 6, cars: 18 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const styleOf = (el: Element | null): Record<string, unknown> =>
  JSON.parse(el?.getAttribute('data-style') ?? '{}') as Record<string, unknown>;

describe('ClubStatsSection', () => {
  it('renders the section label and the three counters', () => {
    render(<ClubStatsSection stats={STATS} />);
    expect(container.textContent).toContain(inicioCopy.sections.clubStats);
    expect(container.textContent).toContain(inicioCopy.clubStats.members);
    expect(container.textContent).toContain('128');
    expect(container.textContent).toContain(inicioCopy.clubStats.events);
    expect(container.textContent).toContain('6');
    expect(container.textContent).toContain(inicioCopy.clubStats.garage);
    expect(container.textContent).toContain('18');
  });

  it('renders zeros for a brand new club rather than hiding the section', () => {
    // Catches: a falsy-check like `if (!stats.members)` anywhere that would
    // treat 0 as "no value" and hide a counter or fall back to a dash.
    render(<ClubStatsSection stats={{ members: 0, events: 0, cars: 0 }} />);
    expect(container.textContent).toContain(inicioCopy.sections.clubStats);
    // `toContain('0')` alone would still pass if only one of the three
    // counters rendered its zero (e.g. a mutation hiding just `cars` when
    // zero, since `members`/`events` would still print a '0'). Count the
    // zero-valued numeral spans directly: StatCard renders `value` as its
    // own <span>, so a per-counter drop shows up as fewer than 3.
    const zeroValues = Array.from(container.querySelectorAll('span')).filter(
      (el) => el.textContent === '0',
    );
    expect(zeroValues.length).toBe(3);
  });

  it('renders nothing when stats are unavailable', () => {
    render(<ClubStatsSection stats={null} />);
    // Catches: deleting the `if (!stats) return null;` early return, which
    // would render a "STATUS DO CLUBE" heading with nothing under it.
    expect(container.textContent).toBe('');
    expect(container.querySelector('span')).toBeNull();
    // The two assertions above pass even for a mutation that returns an empty
    // `<View style={styles.wrap} />` (no text, no span, but still a <div>
    // child of container). This is the actual proof of an early `return null`.
    expect(container.firstChild).toBeNull();
  });

  it('pins the stats grid as a row with the handoff gap', () => {
    render(<ClubStatsSection stats={STATS} />);
    const outer = container.querySelector('div[data-style]');
    const grid = outer?.querySelector('div[data-style]') ?? null;
    // Catches: changing styles.grid's flexDirection away from 'row' (which
    // would stack the three counters vertically instead of side by side),
    // or its gap away from 12.
    expect(styleOf(grid).flexDirection).toBe('row');
    expect(styleOf(grid).gap).toBe(12);
  });
});
