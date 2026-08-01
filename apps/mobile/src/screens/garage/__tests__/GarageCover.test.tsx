// @vitest-environment jsdom
//
// GarageCover tests. The component lives in `apps/mobile/src/screens/garage/`
// (RN-only; not in `@ccc/ui` because declaring `expo-linear-gradient` on the
// shared package broke admin's React resolution — see plan §C12 fallback).
// Pattern mirrors ParkingStallCard.test.tsx: react-native + expo-linear-gradient
// are mocked to jsdom-friendly tags so the renderer doesn't blow up under jsdom.

import { act, type ReactNode } from 'react';
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
        resizeMode,
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
      if (
        source &&
        typeof source === 'object' &&
        typeof (source as { uri?: unknown }).uri === 'string'
      ) {
        aria['data-src'] = (source as { uri: string }).uri;
      }
      void style;
      void hitSlop;
      void numberOfLines;
      void accessible;
      void resizeMode;
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

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { r2PublicBaseUrl: 'https://r2.test' } } },
}));

vi.mock('expo-linear-gradient', async () => {
  const ReactMod = await import('react');
  const LinearGradient = ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    const { style, colors, locations, testID, children, ...rest } = props;
    const aria: Record<string, unknown> = {};
    if (typeof testID === 'string') aria['data-testid'] = testID;
    void style;
    void colors;
    void locations;
    return ReactMod.createElement('div', { ...rest, ...aria, ref }, children as ReactNode);
  });
  return { LinearGradient };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('GarageCover', () => {
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

  it('renders the default-door preset when nothing else is set', async () => {
    const { GarageCover } = await import('../GarageCover');
    await renderEl(
      <GarageCover
        coverPreset={null}
        coverImageUrl={null}
        isPremiumActive={false}
        testID="cover"
      />,
    );
    expect(container.querySelector('[data-testid="cover"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cover-preset-default-door"]')).not.toBeNull();
  });

  it('prefers coverImageUrl when premium', async () => {
    const { GarageCover } = await import('../GarageCover');
    await renderEl(
      <GarageCover
        coverPreset="tokyo-wangan"
        coverImageUrl="https://r2.example.com/garage-cover/u1/abc.jpg"
        isPremiumActive
        testID="cover"
      />,
    );
    const img = container.querySelector('[data-testid="cover-image"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('data-src')).toBe('https://r2.example.com/garage-cover/u1/abc.jpg');
  });

  it('renders the R2 preset image when r2PublicBaseUrl is set', async () => {
    const { GarageCover } = await import('../GarageCover');
    await renderEl(
      <GarageCover
        coverPreset="autobahn-blue"
        coverImageUrl={null}
        isPremiumActive
        testID="cover"
      />,
    );
    const img = container.querySelector('[data-testid="cover-preset-image"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('data-src')).toBe(
      'https://r2.test/garage-cover-presets/autobahn-blue@2x.jpg',
    );
  });

  it('ignores premium preset when isPremiumActive is false', async () => {
    const { GarageCover } = await import('../GarageCover');
    await renderEl(
      <GarageCover
        coverPreset="tokyo-wangan"
        coverImageUrl={null}
        isPremiumActive={false}
        testID="cover"
      />,
    );
    expect(container.querySelector('[data-testid="cover-preset-default-door"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cover-preset-tokyo-wangan"]')).toBeNull();
  });
});
