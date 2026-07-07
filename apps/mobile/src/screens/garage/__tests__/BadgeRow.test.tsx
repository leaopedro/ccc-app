// @vitest-environment jsdom
//
// BadgeRow tests. The component lives in `packages/ui/src/`, but the tests
// live here so the mobile workspace's vitest picks them up — `@jdm/ui` has
// no test runner of its own (verified via packages/ui/package.json). Same
// mocking pattern as HexBadge / ParkingStallCard tests.
//
// Covers the §C11 locked-tile precedent: locked + locked_premium tiles MUST
// be pressable and route to `onLockedPress(code)` so the upsell can be wired
// in chunk 19 — never disabled / dead-tap.

import type { GarageBadgesOwnerResponse } from '@jdm/shared/badges';
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
  // Mirror the explicit named-export list from HexBadge.test.tsx — keep in
  // sync with `packages/ui/src/BadgeGlyph.tsx` ICON_MAP imports.
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

const CATALOG: GarageBadgesOwnerResponse['catalog'] = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', premiumExclusive: false, icon: 'flag' },
  { code: 'EVT-002', category: 'eventos', rarity: 'rare', premiumExclusive: false, icon: 'streak' },
  {
    code: 'EVT-003',
    category: 'eventos',
    rarity: 'legendary',
    premiumExclusive: false,
    icon: 'medal',
  },
  { code: 'CAR-001', category: 'carros', rarity: 'common', premiumExclusive: false, icon: 'car' },
  {
    code: 'CAR-002',
    category: 'carros',
    rarity: 'rare',
    premiumExclusive: false,
    icon: 'garageFull',
  },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    premiumExclusive: false,
    icon: 'curator',
  },
  {
    code: 'COM-001',
    category: 'comunidade',
    rarity: 'common',
    premiumExclusive: false,
    icon: 'post',
  },
  { code: 'JDM-001', category: 'jdm', rarity: 'common', premiumExclusive: false, icon: 'pin' },
  {
    code: 'JDM-003',
    category: 'jdm',
    rarity: 'legendary',
    premiumExclusive: true,
    icon: 'founder',
  },
];

describe('BadgeRow', () => {
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

  it('returns null when enabled=false', async () => {
    const { BadgeRow } = await import('@jdm/ui');
    const data: GarageBadgesOwnerResponse = {
      enabled: false,
      catalog: CATALOG,
      badges: [],
    };
    await renderEl(
      <BadgeRow data={data} onOpenSheet={() => undefined} onLockedPress={() => undefined} />,
    );
    expect(container.children.length).toBe(0);
  });

  it('renders pinned badges first, then other earned, then locked', async () => {
    const { BadgeRow } = await import('@jdm/ui');
    const data: GarageBadgesOwnerResponse = {
      enabled: true,
      catalog: CATALOG,
      badges: [
        {
          code: 'CAR-001',
          state: 'earned',
          earnedAt: '2026-02-10T11:30:00Z',
          pinned: false,
          pinnedAt: null,
        },
        {
          code: 'EVT-002',
          state: 'earned',
          earnedAt: '2026-02-20T12:00:00Z',
          pinned: true,
          pinnedAt: '2026-02-20T12:00:00Z',
        },
      ],
    };
    await renderEl(
      <BadgeRow data={data} onOpenSheet={() => undefined} onLockedPress={() => undefined} />,
    );
    // Pinned EVT-002 (rare/streak) should be the FIRST badge button rendered
    // among the hex tiles. The first <button> in the row is the badge
    // labelled by code in the aria-label.
    const allButtons = Array.from(container.querySelectorAll('button'));
    // Skip the "Ver todas" header button — find the first badge button
    // (the ones we register an aria-label starting with "Conquista ").
    const badgeButtons = allButtons.filter((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista '),
    );
    expect(badgeButtons.length).toBeGreaterThanOrEqual(2);
    expect(badgeButtons[0]?.getAttribute('aria-label')).toContain('EVT-002');
    expect(badgeButtons[1]?.getAttribute('aria-label')).toContain('CAR-001');
  });

  it('shows the "+N" overflow chip when more than 4 badges would render', async () => {
    const { BadgeRow } = await import('@jdm/ui');
    // 6 earned badges → first 4 render as hexes, +2 chip.
    const data: GarageBadgesOwnerResponse = {
      enabled: true,
      catalog: CATALOG,
      badges: [
        {
          code: 'EVT-001',
          state: 'earned',
          earnedAt: '2026-02-10T00:00:00Z',
          pinned: true,
          pinnedAt: '2026-02-10T00:00:00Z',
        },
        {
          code: 'EVT-002',
          state: 'earned',
          earnedAt: '2026-02-11T00:00:00Z',
          pinned: true,
          pinnedAt: '2026-02-11T00:00:00Z',
        },
        {
          code: 'CAR-001',
          state: 'earned',
          earnedAt: '2026-02-12T00:00:00Z',
          pinned: false,
          pinnedAt: null,
        },
        {
          code: 'CAR-002',
          state: 'earned',
          earnedAt: '2026-02-13T00:00:00Z',
          pinned: false,
          pinnedAt: null,
        },
        {
          code: 'COM-001',
          state: 'earned',
          earnedAt: '2026-02-14T00:00:00Z',
          pinned: false,
          pinnedAt: null,
        },
        {
          code: 'JDM-001',
          state: 'earned',
          earnedAt: '2026-02-15T00:00:00Z',
          pinned: false,
          pinnedAt: null,
        },
      ],
    };
    await renderEl(
      <BadgeRow data={data} onOpenSheet={() => undefined} onLockedPress={() => undefined} />,
    );
    expect(textOf()).toContain('+2');
  });

  it('fires onOpenSheet when an earned tile is tapped', async () => {
    const fn = vi.fn();
    const { BadgeRow } = await import('@jdm/ui');
    const data: GarageBadgesOwnerResponse = {
      enabled: true,
      catalog: CATALOG,
      badges: [
        {
          code: 'EVT-001',
          state: 'earned',
          earnedAt: '2026-02-10T00:00:00Z',
          pinned: true,
          pinnedAt: '2026-02-10T00:00:00Z',
        },
      ],
    };
    await renderEl(<BadgeRow data={data} onOpenSheet={fn} onLockedPress={() => undefined} />);
    const badgeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    if (!badgeBtn) throw new Error('earned badge button not rendered');
    await act(async () => {
      badgeBtn.click();
      await flush();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires onLockedPress (not onOpenSheet) when a locked tile is tapped', async () => {
    const openSheet = vi.fn();
    const lockedPress = vi.fn();
    const { BadgeRow } = await import('@jdm/ui');
    // No earned badges → row falls back to showing locked tiles. The first
    // catalog entry is EVT-001 (locked).
    const data: GarageBadgesOwnerResponse = {
      enabled: true,
      catalog: CATALOG,
      badges: [
        { code: 'EVT-001', state: 'locked' },
        { code: 'JDM-003', state: 'locked_premium' },
      ],
    };
    await renderEl(<BadgeRow data={data} onOpenSheet={openSheet} onLockedPress={lockedPress} />);
    const lockedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    if (!lockedBtn) throw new Error('locked badge button not rendered');
    await act(async () => {
      lockedBtn.click();
      await flush();
    });
    expect(lockedPress).toHaveBeenCalledTimes(1);
    expect(lockedPress).toHaveBeenCalledWith('EVT-001');
    expect(openSheet).not.toHaveBeenCalled();
  });

  it('locked tiles are pressable (NOT aria-disabled) per §C11 precedent', async () => {
    const { BadgeRow } = await import('@jdm/ui');
    const data: GarageBadgesOwnerResponse = {
      enabled: true,
      catalog: CATALOG,
      badges: [{ code: 'JDM-003', state: 'locked_premium' }],
    };
    await renderEl(
      <BadgeRow data={data} onOpenSheet={() => undefined} onLockedPress={() => undefined} />,
    );
    const lockedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista JDM-003'),
    );
    expect(lockedBtn).not.toBeUndefined();
    expect(lockedBtn?.getAttribute('aria-disabled')).not.toBe('true');
  });
});
