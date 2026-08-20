// @vitest-environment jsdom
//
// MemberHome tests. Mocks `useMemberHomeData`, `useHomeContent`,
// `useClubStats`, `useUnreadCount`, `~/auth/context` and `expo-router` — the
// screen's own assembly is what's under test here, not any hook's fetching
// logic (that lives in useMemberHomeData.ts and is exercised by reasoning +
// a throwaway smoke check, per the task-11 report). Each mocked hook has its
// own `vi.hoisted` mutable holder, reassigned in `beforeEach` to a full
// "happy path" scenario; individual tests override just the field they need.
//
// `MemberHome` is imported with a dynamic `await import('../MemberHome')`
// inside each test, not a static top-level import: it transitively pulls in
// `@ccc/ui` (MyGarageSection → XPScoreboard, SubscriptionSection →
// PremiumBadge), and this file's own `vi.mock('react-native', ...)` factory
// is itself async (`await import('react')`) — mirrors the mandatory idiom
// from XPScoreboard.test.tsx / member-sections.test.tsx so the real
// `@ccc/ui` module only ever sees the mocked react-native/react-native-svg.

import type { BoxView } from '@ccc/shared/box';
import type { PublicUser } from '@ccc/shared/auth';
import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import type { EventSummary } from '@ccc/shared/events';
import type { HomeContentResponse } from '@ccc/shared/home';
import type { PublicProfile } from '@ccc/shared/profile';
import type { MyTicket } from '@ccc/shared/tickets';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GarageReadResponse } from '~/api/garage';
import type { PremiumStatusResponse } from '~/api/premium';
import { inicioCopy } from '~/copy/inicio';
import { formatMemberSince } from '~/screens/inicio/format-member';
import type { MemberHomeData, SourceState } from '~/screens/inicio/useMemberHomeData';

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
        accessibilityState,
        accessibilityElementsHidden,
        importantForAccessibility,
        testID,
        onPress,
        hitSlop,
        pointerEvents,
        resizeMode,
        source,
        horizontal,
        showsHorizontalScrollIndicator,
        showsVerticalScrollIndicator,
        contentContainerStyle,
        accessible,
        numberOfLines,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
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
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      if (
        source &&
        typeof source === 'object' &&
        typeof (source as { uri?: unknown }).uri === 'string'
      ) {
        aria['data-src'] = (source as { uri: string }).uri;
      }
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      const resolvedContentStyle = resolveStyle(contentContainerStyle);
      if (resolvedContentStyle) aria['data-content-style'] = JSON.stringify(resolvedContentStyle);
      void className;
      void hitSlop;
      void pointerEvents;
      void resizeMode;
      void horizontal;
      void showsHorizontalScrollIndicator;
      void showsVerticalScrollIndicator;
      void accessible;
      void numberOfLines;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    SafeAreaView: make('div'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
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
    Rect: make('rect'),
    LinearGradient: make('lineargradient'),
    Stop: make('stop'),
  };
});

vi.mock('expo-linear-gradient', async () => {
  const ReactMod = await import('react');
  return {
    LinearGradient: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { colors, start, end, style, ...rest } = props;
      const aria: Record<string, unknown> = {};
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      void colors;
      void start;
      void end;
      return ReactMod.createElement('div', { ref, ...rest, ...aria });
    }),
  };
});

const memberHomeDataState = vi.hoisted(() => ({ value: null as unknown }));
const homeContentState = vi.hoisted(() => ({ value: null as unknown }));
const clubStatsState = vi.hoisted(() => ({ value: null as unknown }));
const unreadCountState = vi.hoisted(() => ({ value: null as unknown }));
const authState = vi.hoisted(() => ({ value: null as unknown }));
const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
// Fix round 1 (Minor 6): records the `enabled` argument MemberHome passes
// to useUnreadCount, so a regression to `useUnreadCount(false)` (which would
// silently kill badge polling in production while every bell test here
// stayed green) has something to be caught by.
const unreadCountArgs = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('~/screens/inicio/useMemberHomeData', () => ({
  useMemberHomeData: () => memberHomeDataState.value,
}));
vi.mock('~/hooks/useHomeContent', () => ({
  useHomeContent: () => homeContentState.value,
}));
vi.mock('~/hooks/useClubStats', () => ({
  useClubStats: () => clubStatsState.value,
}));
vi.mock('~/hooks/useUnreadCount', () => ({
  useUnreadCount: (enabled: boolean) => {
    unreadCountArgs.fn(enabled);
    return unreadCountState.value;
  },
}));
vi.mock('~/auth/context', () => ({
  useAuth: () => authState.value,
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: routerMocks.push }),
}));

let container: HTMLDivElement;
let root: Root;

const render = (node: React.ReactNode) => act(() => root.render(node));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const ISO = '2026-01-01T00:00:00.000Z';

const source = <T,>(data: T | null): SourceState<T> => ({ data, loading: false, error: false });

const EVENT: EventSummary = {
  id: 'evt_1',
  slug: 'trackday-2026',
  title: 'Trackday SP',
  coverUrl: 'https://cdn.example.com/evt.jpg',
  startsAt: '2026-09-10T13:00:00.000Z',
  endsAt: '2026-09-10T18:00:00.000Z',
  venueName: 'Autódromo',
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'drift',
  status: 'published',
};

const TICKET_VALID: MyTicket = {
  id: 'tkt_1',
  code: 'CODE1',
  status: 'valid',
  source: 'purchase',
  tierName: 'Pista',
  nickname: null,
  usedAt: null,
  createdAt: ISO,
  event: EVENT,
  extras: [],
  pickupOrders: [],
  pickupVouchers: [],
};

const makeGarageOwner = (
  overrides: Partial<GarageReadResponse['garage']> = {},
): GarageReadResponse['garage'] => ({
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
  availableSlots: 0,
  freeLimit: 1,
  isUnlimited: false,
  gamification: { enabled: true },
  progress: {
    xp: 1200,
    rank: 'Veterano',
    nextRank: 'Lendário',
    xpInTier: 400,
    xpToNextRank: 200,
    tierSpan: 600,
  },
  ...overrides,
});

const GARAGE_PREMIUM = makeGarage({ garage: makeGarageOwner({ isPremiumActive: true }) });
const GARAGE_NON_PREMIUM = makeGarage({ garage: makeGarageOwner({ isPremiumActive: false }) });

const PREMIUM_ACTIVE: PremiumStatusResponse = {
  active: true,
  tier: 'gold',
  cadence: 'monthly',
  provider: 'stripe',
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  manageUrl: 'https://billing.example.com/portal',
};

const PREMIUM_INACTIVE: PremiumStatusResponse = {
  active: false,
  tier: null,
  cadence: null,
  provider: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

const BOX: BoxView = {
  id: 'box_1',
  status: 'open',
  fulfillmentStatus: 'unfulfilled',
  cycleKey: '2026-08',
  cutoffAt: '2026-08-25T00:00:00.000Z',
  budgetCents: 20000,
  currency: 'BRL',
  itemsTotalCents: 0,
  partnersTotalCents: 0,
  overflowCents: 0,
  shippingCents: 0,
  chargeCents: 0,
  orderId: null,
  autoSendOptIn: false,
  shippingAddressId: null,
  items: [],
  partnerItems: [],
};

const PROFILE: PublicProfile = {
  id: 'u_1',
  email: 'ana@example.com',
  name: 'Ana Souza',
  role: 'user',
  emailVerifiedAt: ISO,
  createdAt: '2026-03-14T12:00:00.000Z',
  bio: null,
  city: null,
  stateCode: null,
  avatarUrl: null,
  cpf: null,
  phone: null,
};

const AUTH_USER: PublicUser = {
  id: 'u_1',
  email: 'ana@example.com',
  name: 'Ana Souza',
  role: 'user',
  emailVerifiedAt: ISO,
  createdAt: '2026-03-14T12:00:00.000Z',
};

const HOME_CONTENT: HomeContentResponse = {
  hero: { title: 'O clube que rola junto', subtitle: 'Curitiba e além', bannerUrl: null },
  institutional: { title: 'Quem somos', body: 'Um clube de carros.', imageUrl: null },
  benefits: [],
  highlights: [],
  plans: [],
};

const CLUB_STATS: ClubStatsResponse = { members: 120, events: 8, cars: 95 };

const defaultMemberHomeData = (): MemberHomeData => ({
  profile: source(PROFILE),
  nextEvent: source(EVENT),
  tickets: source([TICKET_VALID]),
  garage: source(GARAGE_PREMIUM),
  premium: source(PREMIUM_ACTIVE),
  box: source(BOX),
  refreshAll: vi.fn(),
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  routerMocks.push.mockClear();
  unreadCountArgs.fn.mockClear();
  memberHomeDataState.value = defaultMemberHomeData();
  homeContentState.value = {
    content: HOME_CONTENT,
    loading: false,
    error: false,
    refresh: vi.fn(),
  };
  clubStatsState.value = { stats: CLUB_STATS, loading: false, error: false, refresh: vi.fn() };
  unreadCountState.value = { count: 0, refresh: vi.fn() };
  authState.value = { user: AUTH_USER, status: 'authenticated' };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const renderMemberHome = async () => {
  const { MemberHome } = await import('../MemberHome');
  render(<MemberHome />);
};

describe('MemberHome — full scenario', () => {
  it('renders every block, in the handoff order', async () => {
    await renderMemberHome();
    const text = container.textContent ?? '';
    const markers = [
      'CASA CAR CLUB',
      HOME_CONTENT.hero.title,
      inicioCopy.member.greeting('Ana'),
      inicioCopy.sections.nextEvent,
      inicioCopy.sections.clubStats,
      inicioCopy.sections.myTickets,
      inicioCopy.sections.myGarage,
      inicioCopy.sections.subscription,
      inicioCopy.sections.box,
      inicioCopy.sections.quickAccess,
    ];
    const indices = markers.map((m) => text.indexOf(m));
    // Catches: dropping a block entirely (its marker never appears, index -1).
    indices.forEach((idx, i) => {
      expect(idx, `marker not found: ${markers[i]}`).toBeGreaterThan(-1);
    });
    // Catches: reordering the vertical stack away from the handoff's order.
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1] ?? -1);
    }
    // Fix round 1 (Important 2): the marker above is only the SECTION
    // LABEL, which `NextEventCard` also renders in its own empty state
    // (`inicio/sections/NextEventCard.tsx`), so a regression that fed it
    // `event={null}` would still pass every assertion up to this point.
    // Pin the actual card content and its testID.
    expect(container.querySelector('[data-testid="inicio-next-event"]')).not.toBeNull();
    expect(text).toContain(EVENT.title);
    // Fix round 1 (Important 2): pins `createdAt` actually reaching
    // MemberGreeting — nothing above proves the second ("member since")
    // line renders at all.
    expect(text).toContain(inicioCopy.member.memberSince(formatMemberSince(PROFILE.createdAt)));
  });

  it('never leaks anonymous-state copy into the member screen', async () => {
    await renderMemberHome();
    const text = container.textContent ?? '';
    // Catches: a misplaced conditional later showing signup/subscribe CTAs
    // or the plans section to a paying member.
    expect(text).not.toContain(inicioCopy.cta.signup);
    expect(text).not.toContain(inicioCopy.cta.subscribe);
    expect(text).not.toContain(inicioCopy.sections.plans);
  });

  it('never leaks anonymous-state copy for a non-premium member either', async () => {
    // Fix round 1 (Minor 8): the leak guard above only ran against the
    // premium happy path, so a leak gated on `!isPremiumActive` (i.e. the
    // exact non-premium subscribe-upsell scenario) would not have been
    // caught by it.
    memberHomeDataState.value = {
      ...defaultMemberHomeData(),
      garage: source(GARAGE_NON_PREMIUM),
      premium: source(PREMIUM_INACTIVE),
      box: source(null),
    };
    await renderMemberHome();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.cta.signup);
    expect(text).not.toContain(inicioCopy.cta.subscribe);
    expect(text).not.toContain(inicioCopy.sections.plans);
  });
});

describe('MemberHome — per-block degradation', () => {
  // Fix round 1 (Minor 7): the six sources named in the review are the ones
  // with a distinct "hide the whole block" degradation. `profile` and
  // `nextEvent` degrade differently (greeting still shows the fallback via
  // `useAuth().user.name`; NextEventCard always shows ITS OWN empty state
  // rather than hiding) — still worth pinning so a future regression can't
  // silently couple either of them to an unrelated block.
  it('keeps the rest of the screen when only the profile source fails', async () => {
    memberHomeDataState.value = { ...defaultMemberHomeData(), profile: source(null) };
    await renderMemberHome();
    const text = container.textContent ?? '';
    // The greeting still shows: firstName comes primarily from
    // `useAuth().user.name`, not from the failed profile fetch.
    expect(text).toContain(inicioCopy.member.greeting('Ana'));
    // But `createdAt` only ever comes from the profile response, so the
    // "member since" line must disappear when it fails.
    expect(text).not.toContain(
      inicioCopy.member.memberSince(formatMemberSince(PROFILE.createdAt)),
    );
    expect(text).toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.myGarage);
  });

  it('keeps the rest of the screen when only the next-event source fails', async () => {
    memberHomeDataState.value = { ...defaultMemberHomeData(), nextEvent: source(null) };
    await renderMemberHome();
    const text = container.textContent ?? '';
    // NextEventCard is the one section that does not hide on null data —
    // it shows its own discreet empty state instead (see NextEventCard.tsx).
    // (Not asserting `EVENT.title` absent here: the default ticket fixture
    // reuses the same event, so its title legitimately still appears in
    // the tickets rail — the testID check below is the precise signal that
    // the actual next-event card itself did not render.)
    expect(text).toContain(inicioCopy.empty.noNextEvent);
    expect(container.querySelector('[data-testid="inicio-next-event"]')).toBeNull();
    expect(text).toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.myGarage);
  });

  it('keeps the rest of the screen when only the tickets source fails', async () => {
    memberHomeDataState.value = { ...defaultMemberHomeData(), tickets: source(null) };
    await renderMemberHome();
    const text = container.textContent ?? '';
    // Catches: a tickets failure taking down other blocks (e.g. via a
    // shared Promise.all that rejects together).
    expect(text).not.toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.myGarage);
    expect(text).toContain(inicioCopy.sections.box);
  });

  it('keeps the rest of the screen when only the garage source fails', async () => {
    memberHomeDataState.value = { ...defaultMemberHomeData(), garage: source(null) };
    await renderMemberHome();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.myGarage);
    expect(text).toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.subscription);
  });

  it('keeps the rest of the screen when only useHomeContent fails', async () => {
    homeContentState.value = { content: null, loading: false, error: true, refresh: vi.fn() };
    await renderMemberHome();
    const text = container.textContent ?? '';
    // Catches: the institutional block's failure taking greeting, next
    // event or quick access down with it, proving the per-block rule also
    // holds for the pre-existing (Task 5) institutional content hook, not
    // only for the six sources this task adds.
    expect(text).not.toContain(HOME_CONTENT.hero.title);
    expect(text).toContain(inicioCopy.member.greeting('Ana'));
    expect(text).toContain(inicioCopy.sections.nextEvent);
    expect(text).toContain(inicioCopy.sections.quickAccess);
  });

  it('keeps the rest of the screen when only club stats fails', async () => {
    clubStatsState.value = { stats: null, loading: false, error: true, refresh: vi.fn() };
    await renderMemberHome();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.clubStats);
    expect(text).toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.myGarage);
  });

  it('keeps the rest of the screen when only the premium status source fails', async () => {
    memberHomeDataState.value = { ...defaultMemberHomeData(), premium: source(null) };
    await renderMemberHome();
    const text = container.textContent ?? '';
    // SubscriptionSection renders null for a null status — neither upsell
    // nor active branch, so its own section label disappears too.
    expect(text).not.toContain(inicioCopy.sections.subscription);
    expect(text).toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.myGarage);
  });

  it('keeps the rest of the screen when only the box source fails', async () => {
    memberHomeDataState.value = { ...defaultMemberHomeData(), box: source(null) };
    await renderMemberHome();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.box);
    expect(text).toContain(inicioCopy.sections.myTickets);
    expect(text).toContain(inicioCopy.sections.subscription);
  });
});

describe('MemberHome — premium gate', () => {
  it('hides the box block and shows the upsell for a non-premium member', async () => {
    memberHomeDataState.value = {
      ...defaultMemberHomeData(),
      garage: source(GARAGE_NON_PREMIUM),
      premium: source(PREMIUM_INACTIVE),
      box: source(null),
    };
    await renderMemberHome();
    expect(container.querySelector('[data-testid="inicio-box"]')).toBeNull();
    expect(container.querySelector('[data-testid="inicio-subscription-upsell"]')).not.toBeNull();
  });

  it('shows the box block and the active badge for a premium member', async () => {
    await renderMemberHome();
    expect(container.querySelector('[data-testid="inicio-box"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="inicio-subscription-active"]')).not.toBeNull();
  });

  it('hides the box block even with box data present, when premium.active is false', async () => {
    // Catches: MemberHome wiring `box.data` into BoxSection without also
    // gating on the render-gate source — would leak the monthly-box teaser
    // to a non-subscriber whenever a stale box happened to be present.
    memberHomeDataState.value = {
      ...defaultMemberHomeData(),
      premium: source(PREMIUM_INACTIVE),
      box: source(BOX),
    };
    await renderMemberHome();
    expect(container.querySelector('[data-testid="inicio-box"]')).toBeNull();
  });

  it('keeps box and subscription consistent when garage and premium disagree', async () => {
    // Fix round 1 (Minor 9). `garage.garage.isPremiumActive` and
    // `premium.data.active` are two independent sources for the same
    // real-world fact; they can briefly disagree. This pins the ruling:
    // the box block's RENDER gate reads `premium.data.active` — the same
    // source SubscriptionSection reads — so the two blocks can never
    // visually disagree, even though garage still says isPremiumActive.
    // Catches: reverting BoxSection's `isPremiumActive` prop back to
    // `garage.data.garage.isPremiumActive`, which would show "CAIXA DO MÊS"
    // right next to the "ASSINAR" upsell here.
    memberHomeDataState.value = {
      ...defaultMemberHomeData(),
      garage: source(GARAGE_PREMIUM), // still says isPremiumActive: true
      premium: source(PREMIUM_INACTIVE), // but the subscription lapsed
      box: source(BOX), // and a stale box happens to be present
    };
    await renderMemberHome();
    expect(container.querySelector('[data-testid="inicio-box"]')).toBeNull();
    expect(container.querySelector('[data-testid="inicio-subscription-upsell"]')).not.toBeNull();
  });
});

describe('MemberHome — notification bell', () => {
  it('shows no badge when there are no unread notifications', async () => {
    await renderMemberHome();
    expect(container.querySelector('[data-testid="inicio-bell-badge"]')).toBeNull();
  });

  it('shows the badge with the count when there are unread notifications', async () => {
    unreadCountState.value = { count: 5, refresh: vi.fn() };
    await renderMemberHome();
    const badge = container.querySelector('[data-testid="inicio-bell-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('5');
  });

  it('caps the badge at "99+" above 99 unread notifications', async () => {
    unreadCountState.value = { count: 140, refresh: vi.fn() };
    await renderMemberHome();
    const badge = container.querySelector('[data-testid="inicio-bell-badge"]');
    expect(badge?.textContent).toBe('99+');
  });

  it('navigates to /notifications when the bell is tapped', async () => {
    await renderMemberHome();
    click('inicio-bell');
    expect(routerMocks.push).toHaveBeenCalledWith('/notifications');
  });

  it('enables polling by calling useUnreadCount(true)', async () => {
    // Fix round 1 (Minor 6): the mock previously ignored its argument
    // entirely, so `useUnreadCount(false)` — which kills badge polling in
    // production — kept every bell test above green.
    await renderMemberHome();
    expect(unreadCountArgs.fn).toHaveBeenCalledWith(true);
  });
});

describe('MemberHome — quick access', () => {
  it('navigates to the tapped tile path', async () => {
    await renderMemberHome();
    click('inicio-quick-store');
    // Catches: QuickAccessSection's onNavigate not being wired to the
    // router at all, or wired to the wrong path.
    expect(routerMocks.push).toHaveBeenCalledWith('/store');
  });
});

describe('MemberHome — remaining navigation targets (Important 3)', () => {
  // Fix round 1: only the bell and one quick-access tile were previously
  // clicked, so a wrong path on any of these six targets shipped green.
  it('navigates to /garage when the garage block is tapped', async () => {
    await renderMemberHome();
    click('inicio-garage');
    expect(routerMocks.push).toHaveBeenCalledWith('/garage');
  });

  it('navigates to /caixa when the box block is tapped', async () => {
    await renderMemberHome();
    click('inicio-box');
    expect(routerMocks.push).toHaveBeenCalledWith('/caixa');
  });

  it('navigates to /assinaturas/minha-assinatura from the active subscription link', async () => {
    await renderMemberHome();
    click('inicio-subscription-active');
    expect(routerMocks.push).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  it('navigates to /tickets from the tickets "see all" link', async () => {
    await renderMemberHome();
    click('inicio-tickets-see-all');
    expect(routerMocks.push).toHaveBeenCalledWith('/tickets');
  });

  it('navigates to /tickets/tkt_1 when the ticket card is tapped', async () => {
    await renderMemberHome();
    click('inicio-ticket-tkt_1');
    expect(routerMocks.push).toHaveBeenCalledWith('/tickets/tkt_1');
  });

  it('navigates to /events/trackday-2026 when the next-event card is tapped', async () => {
    await renderMemberHome();
    click('inicio-next-event');
    expect(routerMocks.push).toHaveBeenCalledWith('/events/trackday-2026');
  });
});
