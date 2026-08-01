// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub react-native primitives so PremiumBadge renders into jsdom. Matches
// the pattern used by ParkingStallCard.test.tsx: Pressable → <button>, View →
// <div>, Text → <span>; accessibility + onPress are surfaced as aria-* +
// onClick.
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
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

// `@ccc/ui` barrel now re-exports ParkingStallCard which imports react-native-svg.
// Mock the SVG primitives so the barrel doesn't blow up when this test imports
// the PremiumBadge symbol — match the same shape used in ParkingStallCard.test.tsx.
vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactMod.createElement(tag, { ref, ...props }),
    );
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

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PremiumBadge (mobile)', () => {
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

  it('renders the Premium label when isPremiumActive is true with no tier', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive={true} />);
    expect(container.textContent).toContain('Premium');
  });

  it('renders nothing when isPremiumActive is false', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive={false} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when isPremiumActive is null', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive={null} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when isPremiumActive is undefined', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive={undefined} />);
    expect(container.textContent).toBe('');
  });
});

describe('PremiumBadge V2', () => {
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

  it('renders tier label (Gold) for gold premium', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive tier="gold" size="md" />);
    expect(container.textContent).toContain('Gold');
  });

  it('renders the near-expiry days block when daysLeftUntilExpiry <= 7', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive tier="gold" size="md" daysLeftUntilExpiry={3} />);
    expect(container.textContent).toContain('3d');
  });

  it('omits the days block when daysLeftUntilExpiry > 7', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive tier="gold" size="md" daysLeftUntilExpiry={30} />);
    expect(container.textContent).not.toContain('30d');
  });

  it('invokes onPress when tapped', async () => {
    const fn = vi.fn();
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive tier="gold" size="md" onPress={fn} />);
    const btn = container.querySelector('button');
    if (!btn) throw new Error('pressable not rendered');
    await act(async () => {
      btn.click();
      await flush();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns null when isPremiumActive !== true', async () => {
    const { PremiumBadge } = await import('@ccc/ui');
    await renderEl(<PremiumBadge isPremiumActive={false} tier="gold" />);
    expect(container.textContent).toBe('');
  });
});
