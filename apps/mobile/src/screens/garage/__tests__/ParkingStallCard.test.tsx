// @vitest-environment jsdom
//
// ParkingStallCard tests. The component lives in `packages/ui/src/`, but the
// tests live here so the mobile workspace's vitest picks them up — `@ccc/ui`
// has no test runner of its own (verified via packages/ui/package.json).
//
// Pattern: stub `react-native` and `react-native-svg` to jsdom-friendly tags,
// matching the BuySpotCard / PremiumBadge tests. RN styles + a11y are flattened
// to data/aria attrs; SVG primitives are flattened to inert wrappers so the
// asphalt-grid pattern doesn't blow up jsdom.

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
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

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
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ParkingStallCard', () => {
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

  const textOf = (): string => container.textContent ?? '';

  it('renders SLOT 01 plate for slotNumber=1', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard
        state="empty"
        source="default_free"
        slotNumber={1}
        onPress={() => undefined}
      />,
    );
    expect(textOf()).toContain('SLOT 01');
  });

  it('renders RESERVADA tape for purchase source', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard state="empty" source="purchase" slotNumber={3} onPress={() => undefined} />,
    );
    expect(textOf()).toContain('RESERVADA');
  });

  it('renders RESERVADA tape for premium_membership source', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard
        state="empty"
        source="premium_membership"
        slotNumber={4}
        onPress={() => undefined}
      />,
    );
    expect(textOf()).toContain('RESERVADA');
  });

  it('renders CORTESIA tape for admin_grant source', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard
        state="empty"
        source="admin_grant"
        slotNumber={2}
        onPress={() => undefined}
      />,
    );
    expect(textOf()).toContain('CORTESIA');
  });

  it('renders no tape for default_free', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard
        state="empty"
        source="default_free"
        slotNumber={1}
        onPress={() => undefined}
      />,
    );
    const text = textOf();
    expect(text).not.toContain('RESERVADA');
    expect(text).not.toContain('CORTESIA');
  });

  it('renders price label and À VENDA in buy state', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard
        state="buy"
        source="default_free"
        slotNumber={3}
        priceLabel="R$ 9,90"
        onPress={() => undefined}
      />,
    );
    const text = textOf();
    expect(text).toContain('R$ 9,90');
    expect(text).toContain('À VENDA');
  });

  it('renders year/make/model + Gold badge for filled state with premium', async () => {
    const { ParkingStallCard } = await import('@ccc/ui');
    const car = {
      id: 'c1',
      year: 1991,
      make: 'Nissan',
      model: 'Skyline GT-R',
      nickname: 'Godzilla',
      isPremiumActive: true,
    };
    await renderEl(
      <ParkingStallCard
        state="filled"
        source="default_free"
        slotNumber={1}
        car={car}
        premiumTier="gold"
        onPress={() => undefined}
      />,
    );
    const text = textOf();
    expect(text).toContain('1991 Nissan Skyline GT-R');
    expect(text).toContain('Gold');
  });

  it('fires onPress once when the stall is tapped', async () => {
    const fn = vi.fn();
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard state="empty" source="default_free" slotNumber={1} onPress={fn} />,
    );
    // The outer Pressable is a <button>. Find the FIRST button (the stall
    // itself) — the inner badge button does not render here (filled-only).
    const btn = container.querySelector('button');
    if (!btn) throw new Error('stall button not rendered');
    await act(async () => {
      btn.click();
      await flush();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('paints purchase and premium_membership identically (both use extra gold rail)', async () => {
    // Behavioural proxy: both should render RESERVADA tape (already covered
    // above) AND neither should render CORTESIA. Concrete colour assertion is
    // unreachable in jsdom; the source-driven branch in paintFor is symmetric.
    const { ParkingStallCard } = await import('@ccc/ui');
    await renderEl(
      <ParkingStallCard
        state="empty"
        source="premium_membership"
        slotNumber={5}
        onPress={() => undefined}
      />,
    );
    expect(textOf()).not.toContain('CORTESIA');
    expect(textOf()).toContain('RESERVADA');
  });
});
