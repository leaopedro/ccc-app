// @vitest-environment jsdom
//
// HexBadge tests. The component lives in `packages/ui/src/`, but the tests
// live here so the mobile workspace's vitest picks them up — `@ccc/ui` has
// no test runner of its own (verified via packages/ui/package.json). This
// mirrors the ParkingStallCard / CoverPickerSheet test pattern.
//
// react-native / react-native-svg / lucide-react-native are stubbed to inert
// jsdom-friendly tags so the SVG hex polygon + lucide glyphs don't blow up
// jsdom. Visual assertions are limited to behavioural proxies — text content,
// aria roles, click handlers, and data-testid markers.

import type { HexBadgeProps } from '@ccc/ui';
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
  // Enumerate every Lucide name `BadgeGlyph` imports — vitest validates
  // named imports against the mock surface, so a Proxy fallback is not
  // enough. Keep this list in sync with `packages/ui/src/BadgeGlyph.tsx`
  // ICON_MAP imports.
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

describe('HexBadge', () => {
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

  it('earned variant renders the catalog glyph (Flag for icon=flag)', async () => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    const icon = container.querySelector('i[data-icon]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('data-icon')).toBe('Flag');
  });

  it('locked variant renders the Lock glyph', async () => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge code="CAR-003" variant="locked" rarity="legendary" icon="curator" size="md" />,
    );
    const icon = container.querySelector('i[data-icon]');
    expect(icon?.getAttribute('data-icon')).toBe('Lock');
  });

  it('locked_premium variant renders the "Exclusivo Premium" tag', async () => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge
        code="JDM-003"
        variant="locked_premium"
        rarity="legendary"
        icon="founder"
        size="md"
      />,
    );
    expect(container.textContent ?? '').toContain('Exclusivo Premium');
  });

  it('earned variant does NOT render the Premium tag', async () => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="md" />,
    );
    expect(container.textContent ?? '').not.toContain('Exclusivo Premium');
  });

  it('renders a button when onPress is provided and fires it on click', async () => {
    const fn = vi.fn();
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge
        code="EVT-001"
        variant="earned"
        rarity="common"
        icon="flag"
        size="md"
        onPress={fn}
      />,
    );
    const btn = container.querySelector('button');
    if (!btn) throw new Error('hex button not rendered');
    await act(async () => {
      btn.click();
      await flush();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('renders an unknown icon string as HelpCircle (no crash)', async () => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="not-a-real-icon" size="md" />,
    );
    const icon = container.querySelector('i[data-icon]');
    expect(icon?.getAttribute('data-icon')).toBe('HelpCircle');
  });

  it('accepts sm and lg sizes without error', async () => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="sm" />,
    );
    expect(container.querySelector('i[data-icon]')?.getAttribute('data-icon')).toBe('Flag');
    await renderEl(
      <HexBadge code="EVT-001" variant="earned" rarity="common" icon="flag" size="lg" />,
    );
    expect(container.querySelector('i[data-icon]')?.getAttribute('data-icon')).toBe('Flag');
  });

  const dot = () => container.querySelector('[data-testid="hex-legendary-dot"]');
  type RestProps = Pick<HexBadgeProps, 'variant' | 'rarity' | 'size'>;
  const renderHex = async (props: RestProps) => {
    const { HexBadge } = await import('@ccc/ui');
    await renderEl(<HexBadge code="X" icon="flag" {...props} />);
  };

  it('earned legendary md renders the corner-dot', async () => {
    await renderHex({ variant: 'earned', rarity: 'legendary', size: 'md' });
    expect(dot()).not.toBeNull();
  });
  it('earned common md does NOT render the corner-dot', async () => {
    await renderHex({ variant: 'earned', rarity: 'common', size: 'md' });
    expect(dot()).toBeNull();
  });
  it('earned legendary sm suppresses the corner-dot', async () => {
    await renderHex({ variant: 'earned', rarity: 'legendary', size: 'sm' });
    expect(dot()).toBeNull();
  });
  it('locked legendary does NOT render the corner-dot', async () => {
    await renderHex({ variant: 'locked', rarity: 'legendary', size: 'md' });
    expect(dot()).toBeNull();
  });
});
