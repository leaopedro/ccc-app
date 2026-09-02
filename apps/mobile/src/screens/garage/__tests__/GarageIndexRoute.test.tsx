// @vitest-environment jsdom
//
// Chunk 19 — Mobile garage route integration tests. Verifies:
//
//   * ListHeaderComponent order: GarageHeader, WelcomeBanner (when fresh),
//     ExpiredPremiumNotice (when lapsed), BadgeRow (when shouldShow), then
//     VagasSectionHeader. BadgeRow MUST land between ExpiredPremiumNotice
//     and VagasSectionHeader per the plan §19 ordering.
//   * BadgeRow killswitch: gamification.enabled=false → row hidden + sheet
//     does not open even when handler fires.
//   * Empty-fresh-signup guard: zero earned badges AND fresh signup
//     (no cars / no premium) → row hidden.
//   * Tap an earned tile → BadgesSheet renders.
//   * Tap a locked tile → PremiumSheet renders (upsell), not the catalog.
//   * Pin toggle → togglePinBadge() + refetch via getMyBadges().
//
// Pattern mirrors BadgesSheet.test.tsx: jsdom + react-native shims + Modal
// → div when visible. Screen components and expo-router are stubbed so the
// route logic is the unit under test. The badges primitives (BadgeRow /
// BadgesSheet) are NOT mocked — we want them rendered so the e2e wire is
// covered (BadgeRow tile → onLockedPress → PremiumSheet appears).

import type { GarageBadgesOwnerResponse } from '@ccc/shared/badges';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RouteIndex from '../../../../app/(app)/garage/index';

import type { GarageReadResponse } from '~/api/garage';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// ----------------------------------------------------------------------------
// react-native + Modal shims (same shape as BadgesSheet.test.tsx).
// ----------------------------------------------------------------------------

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
        accessibilityViewIsModal,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
        contentContainerStyle,
        animationType,
        transparent,
        onRequestClose,
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
      void contentContainerStyle;
      void animationType;
      void transparent;
      void onRequestClose;
      void accessibilityViewIsModal;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const { visible, children, testID, ...rest } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
      };
      if (!visible) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      void rest;
      return ReactMod.createElement('div', { ref, ...aria }, children);
    },
  );

  const FlatList = ReactMod.forwardRef(
    (
      props: Record<string, unknown> & {
        ListHeaderComponent?: React.ReactNode;
        data?: unknown[];
        renderItem?: ({ item }: { item: unknown }) => React.ReactNode;
        keyExtractor?: (item: unknown) => string;
      },
      ref: unknown,
    ) => {
      const { ListHeaderComponent, data = [], renderItem, keyExtractor, testID, ...rest } = props;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      void rest;
      const items = renderItem
        ? data.map((item, i) =>
            ReactMod.createElement(
              ReactMod.Fragment,
              { key: keyExtractor?.(item) ?? String(i) },
              renderItem({ item }),
            ),
          )
        : null;
      return ReactMod.createElement('div', { ref, ...aria }, ListHeaderComponent, items);
    },
  );

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    FlatList,
    ActivityIndicator: make('span'),
    Modal,
    Share: { share: vi.fn().mockResolvedValue(undefined) },
    // Not iOS: garage-slots.ts hides the buy tile there (final review I3),
    // and this suite doesn't exercise that platform gate.
    Platform: { OS: 'android' },
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

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
    Polygon: make('polygon'),
    Path: make('path'),
  };
});

vi.mock('expo-linear-gradient', async () => {
  const ReactMod = await import('react');
  return {
    LinearGradient: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactMod.createElement('div', { ref, ...props }, props.children as React.ReactNode),
    ),
  };
});

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: 'https://api.test' } } },
}));

// ----------------------------------------------------------------------------
// expo-router shim. The route uses useFocusEffect (run-on-mount), useRouter,
// and useLocalSearchParams. We supply minimal implementations so the
// component can mount in jsdom.
// ----------------------------------------------------------------------------

vi.mock('expo-router', async () => {
  const ReactMod = await import('react');
  return {
    // Behave like the real `useFocusEffect`: run the callback whenever the
    // memoised cb identity changes. The route's cb is wrapped in
    // useCallback([]) so this fires exactly once on mount.
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactMod.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    useRouter: () => ({
      push: vi.fn(),
      setParams: vi.fn(),
    }),
    useLocalSearchParams: () => ({}),
  };
});

// ----------------------------------------------------------------------------
// Mock the heavy garage screens: the route only cares that BadgeRow renders
// between ExpiredPremiumNotice and VagasSectionHeader. Replace each with a
// tagged <div> so the order check is text-based.
// ----------------------------------------------------------------------------

// Chunk 40 — stand-in <ProfileStats /> via a partial @ccc/ui mock that
// preserves every other real export (BadgeRow / BadgesSheet / PremiumSheet
// stay real so existing chunk-19 specs keep their e2e coverage). The stub
// renders a tagged <div> so ordering + the flag props are deterministic
// without booting the real RN canvas inside ProfileStats.
vi.mock('@ccc/ui', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const { createElement: el } = await import('react');
  const Stub = (props: { isFreshSignup?: boolean; viewMode?: string }) =>
    el(
      'div',
      {
        'data-testid': 'mock-profile-stats',
        'data-fresh': props.isFreshSignup === undefined ? '' : String(props.isFreshSignup),
        'data-mode': props.viewMode ?? '',
      },
      'ProfileStats',
    );
  return { ...real, ProfileStats: Stub };
});

vi.mock('~/screens/garage/GarageHeader', async () => {
  const { createElement: el } = await import('react');
  return {
    GarageHeader: () => el('div', { 'data-testid': 'mock-garage-header' }, 'GarageHeader'),
  };
});

vi.mock('~/screens/garage/WelcomeBanner', async () => {
  const { createElement: el } = await import('react');
  return {
    WelcomeBanner: () => el('div', { 'data-testid': 'mock-welcome-banner' }, 'WelcomeBanner'),
  };
});

vi.mock('~/screens/garage/ExpiredPremiumNotice', async () => {
  const { createElement: el } = await import('react');
  return {
    ExpiredPremiumNotice: () =>
      el('div', { 'data-testid': 'mock-expired-premium-notice' }, 'ExpiredPremiumNotice'),
  };
});

vi.mock('~/screens/garage/VagasSectionHeader', async () => {
  const { createElement: el } = await import('react');
  return {
    VagasSectionHeader: () =>
      el('div', { 'data-testid': 'mock-vagas-section-header' }, 'VagasSectionHeader'),
  };
});

vi.mock('~/screens/garage/BuySpotSheet', () => ({
  BuySpotSheet: () => null,
}));

vi.mock('~/screens/garage/useBuySpotFlow', () => ({
  useBuySpotFlow: () => ({
    buySheet: null,
    submitting: false,
    openBuySheet: vi.fn(),
    closeBuySheet: vi.fn(),
    goCheckout: vi.fn(),
  }),
}));

// ----------------------------------------------------------------------------
// Mock the API helpers — controlled per-test via setApi below.
// ----------------------------------------------------------------------------

type Tweaks = {
  garage?: GarageReadResponse;
  badges?: GarageBadgesOwnerResponse | null;
  togglePinResult?: { code: string; pinned: boolean };
};

const apiState: {
  getGarage: ReturnType<typeof vi.fn>;
  getMyBadges: ReturnType<typeof vi.fn>;
  togglePinBadge: ReturnType<typeof vi.fn>;
} = {
  getGarage: vi.fn(),
  getMyBadges: vi.fn(),
  togglePinBadge: vi.fn(),
};

vi.mock('~/api/garage', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getGarage: (...args: unknown[]): unknown => apiState.getGarage(...args) as unknown,
    getMyBadges: (...args: unknown[]): unknown => apiState.getMyBadges(...args) as unknown,
    togglePinBadge: (...args: unknown[]): unknown => apiState.togglePinBadge(...args) as unknown,
  };
});

// Chunk 40 — hoist the route component into outer test scope so the
// killswitch-re-enable test below can unmount() + re-render() without
// re-deriving from inside mount(). Vitest hoists vi.mock() calls above
// imports automatically, so the mocks above apply when this resolves.

// ----------------------------------------------------------------------------
// Fixture helpers.
// ----------------------------------------------------------------------------

const ISO = '2026-05-20T12:00:00.000Z';

const makeGarageOwner = (overrides: Partial<GarageReadResponse['garage']> = {}) => ({
  id: 'g_1',
  name: 'Garagem',
  slug: 'user-abc12345',
  description: null,
  isPublic: false,
  premiumTier: null,
  premiumUntil: null,
  isPremiumActive: false,
  coverPreset: null,
  coverImageObjectKey: null,
  coverImageUrl: null,
  daysLeftUntilExpiry: null,
  createdAt: ISO,
  updatedAt: ISO,
  gamification: { enabled: true },
  badges: [],
  ...overrides,
});

const makeGarage = (overrides: Partial<GarageReadResponse> = {}): GarageReadResponse => ({
  garage: makeGarageOwner(),
  cars: [],
  spots: [{ id: 'sp_1', source: 'default_free', carId: null, createdAt: ISO }],
  availableSlots: 1,
  freeLimit: 1,
  isUnlimited: false,
  gamification: { enabled: true },
  purchaseOption: {
    variantId: 'var_garage',
    basePriceCents: 5000,
    displayPriceCents: 5500,
    devFeePercent: 10,
    currency: 'BRL',
  },
  ...overrides,
});

const CATALOG: GarageBadgesOwnerResponse['catalog'] = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', premiumExclusive: false, icon: 'flag' },
  { code: 'CAR-001', category: 'carros', rarity: 'common', premiumExclusive: false, icon: 'car' },
  {
    code: 'CCC-003',
    category: 'ccc',
    rarity: 'legendary',
    premiumExclusive: true,
    icon: 'founder',
  },
];

const makeBadgesAggregate = (
  overrides: Partial<GarageBadgesOwnerResponse> = {},
): GarageBadgesOwnerResponse => ({
  enabled: true,
  catalog: CATALOG,
  badges: [],
  ...overrides,
});

const earnedBadge = (code: string, pinned = false) => ({
  code,
  state: 'earned' as const,
  earnedAt: '2026-02-10T11:30:00.000Z',
  pinned,
  pinnedAt: pinned ? '2026-02-10T11:30:00.000Z' : null,
});

const lockedBadge = (code: string, premium = false) => ({
  code,
  state: premium ? ('locked_premium' as const) : ('locked' as const),
});

const carCivic = {
  id: 'car_1',
  make: 'Honda',
  model: 'Civic',
  year: 2002,
  nickname: 'Apelidinho',
  modifications: [] as string[],
  photo: null,
  photos: [] as Array<{ id: string; url: string; width: number | null; height: number | null }>,
  isPremiumActive: false,
  createdAt: ISO,
  updatedAt: ISO,
};

const setApi = (t: Tweaks) => {
  apiState.getGarage.mockResolvedValue(t.garage ?? makeGarage());
  apiState.getMyBadges.mockResolvedValue(t.badges ?? makeBadgesAggregate());
  apiState.togglePinBadge.mockResolvedValue({
    badge: {
      code: t.togglePinResult?.code ?? 'EVT-001',
      earnedAt: '2026-02-10T11:30:00.000Z',
      pinned: t.togglePinResult?.pinned ?? true,
      pinnedAt: '2026-02-10T11:30:00.000Z',
    },
  });
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('GarageIndex route — chunk 19 BadgeRow integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    apiState.getGarage.mockReset();
    apiState.getMyBadges.mockReset();
    apiState.togglePinBadge.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const mount = async () => {
    const RouteMod = await import('../../../../app/(app)/garage/index');
    const Route = RouteMod.default;
    await act(async () => {
      root.render(<Route />);
      await flush();
    });
    // Drain the chain: useFocusEffect → getGarage → setGarage →
    // gamification-dependent useEffect → getMyBadges → setBadgesAggregate.
    // Each await flush() lets one tier of microtasks settle.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await flush();
      });
    }
  };

  it('renders BadgeRow between ExpiredPremiumNotice and VagasSectionHeader when user has earned badges', async () => {
    setApi({
      // Lapsed-premium user with cars + an earned badge → header shows
      // ExpiredPremiumNotice (lapse) but NOT WelcomeBanner (not fresh).
      garage: makeGarage({
        garage: makeGarageOwner({
          premiumTier: 'gold',
          isPremiumActive: false,
          badges: [earnedBadge('EVT-001')],
        }),
        cars: [carCivic],
      }),
      badges: makeBadgesAggregate({ badges: [earnedBadge('EVT-001')] }),
    });
    await mount();
    const badgeRow = container.querySelector('[data-testid="garage-badge-row"]');
    expect(badgeRow).not.toBeNull();
    const expired = container.querySelector('[data-testid="mock-expired-premium-notice"]');
    const vagas = container.querySelector('[data-testid="mock-vagas-section-header"]');
    expect(expired).not.toBeNull();
    expect(vagas).not.toBeNull();
    // Document order: expired → badge-row → vagas.
    const all = Array.from(container.querySelectorAll('*'));
    const expiredIdx = all.indexOf(expired!);
    const rowIdx = all.indexOf(badgeRow!);
    const vagasIdx = all.indexOf(vagas!);
    expect(expiredIdx).toBeLessThan(rowIdx);
    expect(rowIdx).toBeLessThan(vagasIdx);
  });

  it('hides BadgeRow when gamification.enabled is false (killswitch)', async () => {
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({
          gamification: { enabled: false },
          badges: [],
        }),
      }),
      badges: makeBadgesAggregate({ enabled: false, badges: [] }),
    });
    await mount();
    expect(container.querySelector('[data-testid="garage-badge-row"]')).toBeNull();
    // Killswitch off → getMyBadges MUST NOT be called.
    expect(apiState.getMyBadges).not.toHaveBeenCalled();
  });

  it('hides BadgeRow on fresh signup with zero earned badges (no empty teaser)', async () => {
    // Fresh signup: zero cars + premiumTier null → showWelcomeBanner=true.
    // Zero earned badges → row hidden.
    setApi({
      garage: makeGarage({ cars: [] }),
      badges: makeBadgesAggregate({
        badges: [lockedBadge('EVT-001'), lockedBadge('CAR-001')],
      }),
    });
    await mount();
    expect(container.querySelector('[data-testid="garage-badge-row"]')).toBeNull();
  });

  it('shows BadgeRow on fresh signup once at least one badge is earned', async () => {
    // Fresh signup but CCC-003 was awarded by the founder cohort hook
    // (chunk 18). Row should now render even though cars=0.
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({
          badges: [earnedBadge('CCC-003', true)],
        }),
        cars: [],
      }),
      badges: makeBadgesAggregate({
        badges: [earnedBadge('CCC-003', true)],
      }),
    });
    await mount();
    expect(container.querySelector('[data-testid="garage-badge-row"]')).not.toBeNull();
  });

  it('opens BadgesSheet when an earned tile is tapped', async () => {
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({ badges: [earnedBadge('EVT-001', true)] }),
        cars: [],
      }),
      badges: makeBadgesAggregate({ badges: [earnedBadge('EVT-001', true)] }),
    });
    await mount();
    const earnedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    expect(earnedBtn).not.toBeUndefined();
    await act(async () => {
      earnedBtn!.click();
      await flush();
    });
    // BadgesSheet renders with testID "garage-badges-sheet" once visible.
    expect(container.querySelector('[data-testid="garage-badges-sheet"]')).not.toBeNull();
  });

  it('opens PremiumSheet (NOT BadgesSheet) when a locked tile is tapped', async () => {
    // Locked-only catalog → BadgeRow renders locked tiles. Tap one →
    // onLockedPress → PremiumSheet upsell.
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({
          // Non-fresh signup (has a car) so the empty-fresh guard does not hide the row.
          badges: [],
        }),
        cars: [carCivic],
      }),
      badges: makeBadgesAggregate({
        badges: [lockedBadge('EVT-001'), lockedBadge('CAR-001'), lockedBadge('CCC-003', true)],
      }),
    });
    await mount();
    // Premium sheet exists in tree but is `visible={false}` → not in DOM
    // initially (Modal returns null when visible=false).
    expect(container.querySelector('[data-testid="premium-sheet"]')).toBeNull();
    const lockedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    expect(lockedBtn).not.toBeUndefined();
    await act(async () => {
      lockedBtn!.click();
      await flush();
    });
    expect(container.querySelector('[data-testid="premium-sheet"]')).not.toBeNull();
    // BadgesSheet stays closed when the locked-tap landed.
    expect(container.querySelector('[data-testid="garage-badges-sheet"]')).toBeNull();
  });

  // Final review C2 — the call site, not just the copy helper. This suite runs
  // with EXPO_PUBLIC_CAIXA_ENABLED unset, exactly like both eas build profiles,
  // so the sheet a real member opens must not advertise the physical box: the
  // caixa screens are gated off, the member can never opt in / add items / set
  // an address, and box-cutoff.ts skips exactly those boxes. Fails if a call
  // site goes back to passing an ungated benefits list.
  it('does not advertise the caixa in the premium sheet when the caixa build is off', async () => {
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({ badges: [] }),
        cars: [carCivic],
      }),
      badges: makeBadgesAggregate({
        badges: [lockedBadge('EVT-001'), lockedBadge('CAR-001'), lockedBadge('CCC-003', true)],
      }),
    });
    await mount();
    const lockedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    await act(async () => {
      lockedBtn!.click();
      await flush();
    });
    const sheet = container.querySelector('[data-testid="premium-sheet"]');
    expect(sheet).not.toBeNull();
    const sheetText = (sheet!.textContent ?? '').toLowerCase();
    // Sanity: the sheet really did render its benefit list, so a "no caixa"
    // pass cannot come from an empty sheet.
    expect(sheetText).toContain('capas personalizadas'.toLowerCase());
    expect(sheetText).not.toContain('caixa');
  });

  it('calls togglePinBadge then refetches badges when the pin button is tapped', async () => {
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({ badges: [earnedBadge('EVT-001', false)] }),
        cars: [],
      }),
      badges: makeBadgesAggregate({ badges: [earnedBadge('EVT-001', false)] }),
    });
    await mount();
    // Confirm initial fetch happened once.
    expect(apiState.getMyBadges).toHaveBeenCalledTimes(1);

    // Open the sheet via the earned tile.
    const earnedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    await act(async () => {
      earnedBtn!.click();
      await flush();
    });

    // Drill into the badge so BadgeDetail shows the pin toggle. The catalog
    // grid uses the same aria-label prefix; pick the one INSIDE the sheet.
    const sheet = container.querySelector('[data-testid="garage-badges-sheet"]');
    expect(sheet).not.toBeNull();
    const insideSheetBtn = Array.from(sheet!.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Conquista EVT-001'),
    );
    expect(insideSheetBtn).not.toBeUndefined();
    await act(async () => {
      insideSheetBtn!.click();
      await flush();
    });

    // BadgeDetail's pin button has accessibilityLabel: 'Fixar no perfil público'.
    const pinBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Fixar no perfil público',
    );
    expect(pinBtn).not.toBeUndefined();
    await act(async () => {
      pinBtn!.click();
      await flush();
      await flush();
    });

    expect(apiState.togglePinBadge).toHaveBeenCalledTimes(1);
    expect(apiState.togglePinBadge).toHaveBeenCalledWith('EVT-001', true);
    // Refetch fires after the PATCH resolves.
    expect(apiState.getMyBadges).toHaveBeenCalledTimes(2);
  });

  // Per-mount helper for the re-focus spec. Uses its own container + root so
  // it can unmount + remount cleanly without touching the describe-scope root.
  const mountRoute = async () => {
    const localContainer = document.createElement('div');
    document.body.appendChild(localContainer);
    const localRoot = createRoot(localContainer);
    const RouteMod = await import('../../../../app/(app)/garage/index');
    const Route = RouteMod.default;
    await act(async () => {
      localRoot.render(<Route />);
      await flush();
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await flush();
      });
    }
    return {
      flush,
      unmount: async () => {
        await act(async () => {
          localRoot.unmount();
          await flush();
        });
        localContainer.remove();
      },
    };
  };

  it('drops a stale getMyBadges resolution that lands after blur (cancellation guard)', async () => {
    // Regression for review-round-2 finding: a slow earlier
    // getMyBadges() must not call setBadgesAggregate after the focus
    // effect has been cleaned up. The closure-captured `cancelled` flag
    // is set in the effect's cleanup; without it, a late resolution
    // would write non-null badges onto a torn-down (or newer-focus)
    // component.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolveSlow: ((v: GarageBadgesOwnerResponse) => void) | null = null;
    apiState.getGarage.mockResolvedValue(makeGarage());
    apiState.getMyBadges.mockImplementationOnce(
      () =>
        new Promise<GarageBadgesOwnerResponse>((r) => {
          resolveSlow = r;
        }),
    );

    const route = await mountRoute();
    await route.flush();
    // The effect ran and called getMyBadges; the promise is still pending.
    expect(apiState.getMyBadges).toHaveBeenCalledTimes(1);
    expect(resolveSlow).not.toBeNull();

    // Simulate blur — effect cleanup runs, sets the closure's cancelled = true.
    await route.unmount();

    // Resolve the stale promise AFTER cleanup. The guard must drop it
    // silently — no React "setState on unmounted component" warning,
    // no thrown error.
    await act(async () => {
      resolveSlow?.(makeBadgesAggregate());
      await flush();
    });

    const errors = errSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((m) => m.toLowerCase().includes('unmounted'))).toBe(false);
    errSpy.mockRestore();
  });

  it('refetches badges on re-focus when killswitch flipped on', async () => {
    const base = makeGarage();
    const off: GarageReadResponse = {
      ...base,
      garage: { ...base.garage, gamification: { enabled: false } },
    };
    const on: GarageReadResponse = {
      ...base,
      garage: { ...base.garage, gamification: { enabled: true } },
    };
    apiState.getGarage.mockResolvedValueOnce(off).mockResolvedValueOnce(on);
    apiState.getMyBadges.mockResolvedValue({ enabled: true, catalog: [], badges: [] });

    // First focus: killswitch off → no badges fetch.
    const first = await mountRoute();
    await first.flush();
    expect(apiState.getMyBadges).not.toHaveBeenCalled();
    await first.unmount();

    // Second focus = remount (mocked useFocusEffect runs once per mount).
    // The on payload now flips the killswitch; the consolidated effect
    // must fire getMyBadges.
    const second = await mountRoute();
    await second.flush();
    expect(apiState.getMyBadges).toHaveBeenCalledTimes(1);
    await second.unmount();
  });

  // --------------------------------------------------------------------------
  // Chunk 40 — <ProfileStats /> slot between IdentityCard (inside GarageHeader)
  // and BadgeRow inside ListHeaderComponent. The real ProfileStats is stubbed
  // via the @ccc/ui partial mock at the top of the file; these tests only
  // verify the route's insertion order, killswitch gate, fresh-signup flag
  // pass-through, loading-state hide, and focus-effect re-enable carry-over.
  // --------------------------------------------------------------------------

  it('renders ProfileStats between GarageHeader (IdentityCard) and BadgeRow when an owner has progress + stats', async () => {
    setApi({
      garage: makeGarage({
        garage: makeGarageOwner({ badges: [earnedBadge('EVT-001')] }),
        cars: [carCivic],
        gamification: { enabled: true },
        progress: {
          xp: 137,
          rank: 'Pilotador',
          nextRank: 'Veterano',
          xpInTier: 37,
          xpToNextRank: 363,
          tierSpan: 400,
        },
        stats: { events: 3, posts: 5, likesReceived: 12, joinedAt: ISO },
      }),
      badges: makeBadgesAggregate({ badges: [earnedBadge('EVT-001')] }),
    });
    await mount();
    const header = container.querySelector('[data-testid="mock-garage-header"]');
    const profileStats = container.querySelector('[data-testid="mock-profile-stats"]');
    const badgeRow = container.querySelector('[data-testid="garage-badge-row"]');
    expect(header).not.toBeNull();
    expect(profileStats).not.toBeNull();
    expect(badgeRow).not.toBeNull();
    const all = Array.from(container.querySelectorAll('*'));
    expect(all.indexOf(header!)).toBeLessThan(all.indexOf(profileStats!));
    expect(all.indexOf(profileStats!)).toBeLessThan(all.indexOf(badgeRow!));
    // Owner viewMode + non-fresh user.
    expect(profileStats!.getAttribute('data-mode')).toBe('owner');
    expect(profileStats!.getAttribute('data-fresh')).toBe('false');
  });

  it('hides ProfileStats when gamification.enabled === false (killswitch)', async () => {
    setApi({
      // Killswitch lives at the response top level per outline §C10 / fix-canon §1.
      garage: makeGarage({
        garage: makeGarageOwner(),
        gamification: { enabled: false },
        progress: undefined,
        stats: undefined,
      }),
      badges: makeBadgesAggregate({ enabled: false }),
    });
    await mount();
    expect(container.querySelector('[data-testid="mock-profile-stats"]')).toBeNull();
  });

  it('hides ProfileStats when isFreshSignup is true (owner default per outline §302)', async () => {
    setApi({
      garage: makeGarage({
        // Fresh: zero cars, no premium tier → showWelcomeBanner=true.
        garage: makeGarageOwner(),
        cars: [],
        gamification: { enabled: true },
        progress: {
          xp: 0,
          rank: 'Iniciante',
          nextRank: 'Pilotador',
          xpInTier: 0,
          xpToNextRank: 100,
          tierSpan: 100,
        },
        stats: { events: 0, posts: 0, likesReceived: 0, joinedAt: ISO },
      }),
    });
    await mount();
    // Chunk 39 itself hides on isFreshSignup. Stub mirrors the contract via
    // the data-fresh attribute. The route still RENDERS the wrapper (passes
    // the flag); the wrapper is what hides. Assert flag passes through.
    const node = container.querySelector('[data-testid="mock-profile-stats"]');
    expect(node).not.toBeNull();
    expect(node!.getAttribute('data-fresh')).toBe('true');
  });

  it('does not render ProfileStats until the garage query resolves (loading state)', async () => {
    // Defer the promise resolution so the route's <ActivityIndicator /> is
    // visible and the ListHeaderComponent block is unmounted.
    let resolve: ((v: GarageReadResponse) => void) | null = null;
    apiState.getGarage.mockImplementation(
      () => new Promise<GarageReadResponse>((r) => (resolve = r)),
    );
    apiState.getMyBadges.mockResolvedValue(makeBadgesAggregate());
    await act(async () => {
      root.render(<RouteIndex />);
      await flush();
    });
    expect(container.querySelector('[data-testid="mock-profile-stats"]')).toBeNull();
    // Resolve and let the chain settle.
    await act(async () => {
      resolve!(
        makeGarage({
          gamification: { enabled: true },
          progress: {
            xp: 10,
            rank: 'Iniciante',
            nextRank: 'Pilotador',
            xpInTier: 10,
            xpToNextRank: 90,
            tierSpan: 100,
          },
          stats: { events: 1, posts: 0, likesReceived: 0, joinedAt: ISO },
          cars: [carCivic],
        }),
      );
      for (let i = 0; i < 6; i++) await flush();
    });
    expect(container.querySelector('[data-testid="mock-profile-stats"]')).not.toBeNull();
  });

  it('focus re-enable repaints ProfileStats when killswitch flips on mid-session', async () => {
    // First focus → killswitch off → wrapper hidden. Second focus refetches
    // and flips on. Killswitch path is response top-level per §C10 / canon §1.
    apiState.getMyBadges.mockResolvedValue(makeBadgesAggregate());
    apiState.getGarage
      .mockResolvedValueOnce(
        makeGarage({
          garage: makeGarageOwner(),
          gamification: { enabled: false },
          progress: undefined,
          stats: undefined,
          cars: [carCivic],
        }),
      )
      .mockResolvedValueOnce(
        makeGarage({
          garage: makeGarageOwner(),
          cars: [carCivic],
          gamification: { enabled: true },
          progress: {
            xp: 42,
            rank: 'Iniciante',
            nextRank: 'Pilotador',
            xpInTier: 42,
            xpToNextRank: 58,
            tierSpan: 100,
          },
          stats: { events: 1, posts: 0, likesReceived: 0, joinedAt: ISO },
        }),
      );
    await mount();
    expect(container.querySelector('[data-testid="mock-profile-stats"]')).toBeNull();
    // Simulate a focus event by remounting the route (expo-router's
    // useFocusEffect shim runs on mount in test env). The second mock value
    // is what getGarage resolves on the second call. RouteIndex is hoisted
    // to outer test scope so unmount + re-render references the same module.
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<RouteIndex />);
      for (let i = 0; i < 6; i++) await flush();
    });
    expect(container.querySelector('[data-testid="mock-profile-stats"]')).not.toBeNull();
  });
});
