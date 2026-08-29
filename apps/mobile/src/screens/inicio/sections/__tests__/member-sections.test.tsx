// @vitest-environment jsdom
//
// Testes das sete seções do membro logado (task 10). Reusa o mecanismo
// `data-style`/`resolveStyle` de StoreTeaserSection.test.tsx e o mock de
// `react-native-svg`/`expo-linear-gradient` de XPScoreboard.test.tsx e
// CtaSection.test.tsx, porque MyGarageSection e SubscriptionSection
// compõem `XPScoreboard` e `PremiumBadge` reais de `@ccc/ui`.
//
// MyGarageSection e SubscriptionSection importam `@ccc/ui` dinamicamente
// dentro de cada teste (import() após os vi.mock), espelhando o padrão já
// usado em XPScoreboard.test.tsx / BadgeRow.test.tsx / PremiumBadge.test.tsx
// para os mocks de react-native/react-native-svg serem aplicados antes do
// módulo real de `@ccc/ui` carregar.
//
// Fix round 1 (Minor 4): o mock de `react-native` agora grava `source` (uri
// da Image) em `data-src`, além do `style`/`contentContainerStyle` já
// gravados — necessário para pinar o thumb do NextEventCard e provar qual
// imagem foi de fato passada, não só que *uma* imagem renderizou.

import type { GarageReadResponse } from '~/api/garage';
import type { BoxView } from '@ccc/shared/box';
import type { EventSummary } from '@ccc/shared/events';
import type { PremiumStatus } from '@ccc/shared/premium';
import type { MyTicket } from '@ccc/shared/tickets';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { caixaCopy } from '~/copy/caixa';
import { inicioCopy } from '~/copy/inicio';
import { formatEventDateRange } from '~/lib/format';

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

import { MemberGreeting } from '../MemberGreeting';
import { NextEventCard } from '../NextEventCard';
import { MyTicketsSection } from '../MyTicketsSection';
import { BoxSection } from '../BoxSection';
import { QuickAccessSection } from '../QuickAccessSection';

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

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const ISO = '2026-01-01T00:00:00.000Z';

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

describe('MemberGreeting', () => {
  it('renders the named greeting and the member-since line with a valid name and date', () => {
    render(<MemberGreeting firstName="Ana" createdAt="2026-03-14T12:00:00.000Z" />);
    expect(container.textContent).toContain(inicioCopy.member.greeting('Ana'));
    expect(container.textContent).toContain(inicioCopy.member.memberSince('mar 2026'));
  });

  it('falls back to the generic greeting when firstName is null', () => {
    render(<MemberGreeting firstName={null} createdAt="2026-03-14T12:00:00.000Z" />);
    const heading = container.querySelector('[role="header"]');
    // Fix round 1 (Minor 5): an exact match on the heading's own textContent,
    // not `container.textContent` + `toContain`. `greetingFallback` is a
    // strict prefix of `greeting('Ana')`, so `toContain(greetingFallback)`
    // alone would pass even when the NAMED greeting renders; only the exact
    // match on the heading element actually distinguishes the two.
    expect(heading?.textContent).toBe(inicioCopy.member.greetingFallback);
  });

  it('omits the second line when createdAt is invalid', () => {
    render(<MemberGreeting firstName="Ana" createdAt="not-a-date" />);
    expect(container.textContent).toContain(inicioCopy.member.greeting('Ana'));
    // Fix round 1 (Minor 5): derived from `inicioCopy.member.memberSince('')`
    // instead of a hardcoded 'MEMBRO DESDE' literal, so renaming that copy
    // key cannot silently disarm this assertion.
    expect(container.textContent).not.toContain(inicioCopy.member.memberSince(''));
  });
});

describe('NextEventCard', () => {
  it('renders the title and the pill label', () => {
    render(<NextEventCard event={EVENT} onPress={vi.fn()} />);
    expect(container.textContent).toContain('Trackday SP');
    expect(container.textContent).toContain(inicioCopy.cards.seeEvent);
    const el = container.querySelector('[data-testid="inicio-next-event"]');
    expect(el).not.toBeNull();
  });

  it('renders the formatted date range via the real formatter', () => {
    render(<NextEventCard event={EVENT} onPress={vi.fn()} />);
    // Fix round 1 (Important 1): derived from `formatEventDateRange` itself
    // rather than a hardcoded date string, so a format change cannot
    // silently disarm this. Catches: deleting the calendar metaline.
    expect(container.textContent).toContain(formatEventDateRange(EVENT.startsAt, EVENT.endsAt));
  });

  it('renders the city and state meta line', () => {
    render(<NextEventCard event={EVENT} onPress={vi.fn()} />);
    // Fix round 1 (Important 1): catches deleting the city/state metaline.
    expect(container.textContent).toContain(`${EVENT.city}/${EVENT.stateCode}`);
  });

  it('renders the cover thumb with the correct source and the pinned size', () => {
    render(<NextEventCard event={EVENT} onPress={vi.fn()} />);
    const thumb = container.querySelector('[data-testid="inicio-next-event-thumb"]');
    expect(thumb).not.toBeNull();
    // Fix round 1 (Important 1 + Minor 4): proves the thumb actually wires
    // `event.coverUrl`, not merely that *some* image renders.
    expect(thumb?.getAttribute('data-src')).toBe(EVENT.coverUrl);
    const style = JSON.parse(thumb?.getAttribute('data-style') ?? '{}') as Record<string, unknown>;
    // Fix round 1 (Minor 4): pins the 96px width and 12px radius from the handoff.
    expect(style.width).toBe(96);
    expect(style.borderRadius).toBe(12);
  });

  it('calls onPress with the event slug, not the id, when tapped', () => {
    const onPress = vi.fn();
    render(<NextEventCard event={EVENT} onPress={onPress} />);
    click('inicio-next-event');
    // Catches: passing event.id instead of event.slug.
    expect(onPress).toHaveBeenCalledWith('trackday-2026');
    expect(onPress).not.toHaveBeenCalledWith('evt_1');
  });

  it('renders a discreet empty state instead of the card when event is null', () => {
    render(<NextEventCard event={null} onPress={vi.fn()} />);
    // Catches: returning null instead of the empty state (the one section
    // that deliberately does not follow the render-null rule).
    expect(container.textContent).toContain(inicioCopy.empty.noNextEvent);
    expect(container.querySelector('[data-testid="inicio-next-event"]')).toBeNull();
  });
});

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

const TICKET_REVOKED: MyTicket = {
  ...TICKET_VALID,
  id: 'tkt_2',
  code: 'CODE2',
  status: 'revoked',
  tierName: 'Revogado',
};

describe('MyTicketsSection', () => {
  it('renders only tickets with status "valid", including the title and date', () => {
    render(
      <MyTicketsSection
        tickets={[TICKET_VALID, TICKET_REVOKED]}
        onOpenTicket={vi.fn()}
        onSeeAll={vi.fn()}
      />,
    );
    // Catches: dropping the status filter and rendering every ticket.
    expect(container.textContent).toContain('Pista');
    expect(container.textContent).not.toContain('Revogado');
    // Fix round 1 (Important 2): catches deleting the event title or the
    // date-range line from the ticket card — only `tierName` was pinned
    // before.
    expect(container.textContent).toContain(TICKET_VALID.event.title);
    expect(container.textContent).toContain(
      formatEventDateRange(TICKET_VALID.event.startsAt, TICKET_VALID.event.endsAt),
    );
  });

  it('calls onOpenTicket with the ticket id when a ticket card is tapped', () => {
    const onOpenTicket = vi.fn();
    render(
      <MyTicketsSection tickets={[TICKET_VALID]} onOpenTicket={onOpenTicket} onSeeAll={vi.fn()} />,
    );
    click('inicio-ticket-tkt_1');
    expect(onOpenTicket).toHaveBeenCalledWith('tkt_1');
  });

  it('calls onSeeAll from the footer link', () => {
    const onSeeAll = vi.fn();
    render(
      <MyTicketsSection tickets={[TICKET_VALID]} onOpenTicket={vi.fn()} onSeeAll={onSeeAll} />,
    );
    click('inicio-tickets-see-all');
    expect(onSeeAll).toHaveBeenCalled();
  });

  it('renders null for an empty ticket list', () => {
    render(<MyTicketsSection tickets={[]} onOpenTicket={vi.fn()} onSeeAll={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when the list only has invalid-status tickets', () => {
    render(
      <MyTicketsSection tickets={[TICKET_REVOKED]} onOpenTicket={vi.fn()} onSeeAll={vi.fn()} />,
    );
    // Catches: checking tickets.length === 0 instead of the filtered length.
    expect(container.firstChild).toBeNull();
  });

  it('pins the ticket card width and the horizontal rail gap', () => {
    render(<MyTicketsSection tickets={[TICKET_VALID]} onOpenTicket={vi.fn()} onSeeAll={vi.fn()} />);
    const card = container.querySelector('[data-testid="inicio-ticket-tkt_1"]');
    const cardStyle = JSON.parse(card?.getAttribute('data-style') ?? '{}') as Record<
      string,
      unknown
    >;
    // Fix round 1 (Minor 4): pins the 160px ticket card width.
    expect(cardStyle.width).toBe(160);
    const rail = container.querySelector('div[data-content-style]');
    const railStyle = JSON.parse(rail?.getAttribute('data-content-style') ?? '{}') as Record<
      string,
      unknown
    >;
    // Fix round 1 (Minor 4): pins the 12px rail gap.
    expect(railStyle.gap).toBe(12);
  });
});

describe('MyGarageSection', () => {
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

  it('renders when the top-level gamification killswitch is enabled', async () => {
    const { MyGarageSection } = await import('../MyGarageSection');
    render(<MyGarageSection garage={makeGarage()} onPress={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.sections.myGarage);
    expect(container.querySelector('[data-testid="inicio-garage"]')).not.toBeNull();
  });

  it('renders null when the top-level gamification.enabled is false', async () => {
    const { MyGarageSection } = await import('../MyGarageSection');
    render(
      <MyGarageSection
        garage={makeGarage({ gamification: { enabled: false } })}
        onPress={vi.fn()}
      />,
    );
    // Catches: removing the killswitch guard, or reading the deprecated
    // nested `garage.garage.gamification.enabled` instead of the top-level one.
    expect(container.firstChild).toBeNull();
  });

  it('renders null when garage is null', async () => {
    const { MyGarageSection } = await import('../MyGarageSection');
    render(<MyGarageSection garage={null} onPress={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onPress when the block is tapped', async () => {
    const { MyGarageSection } = await import('../MyGarageSection');
    const onPress = vi.fn();
    render(<MyGarageSection garage={makeGarage()} onPress={onPress} />);
    click('inicio-garage');
    expect(onPress).toHaveBeenCalled();
  });

  it('still shows the car/spot count line, so the card is never empty, when progress is absent', async () => {
    const { MyGarageSection } = await import('../MyGarageSection');
    render(<MyGarageSection garage={makeGarage({ progress: undefined })} onPress={vi.fn()} />);
    // Fix round 1 (Minor 3): with badges dropped (ruling R1) and `progress`
    // optional per `garageReadSchema`, the count line is what keeps this
    // section from rendering a `SectionLabel` over an empty `FeatureCard`.
    // Fixture has 0 cars and 1 spot (see makeGarage's default `spots`).
    expect(container.textContent).toContain(inicioCopy.garage.counts(0, 1));
    expect(container.firstChild).not.toBeNull();
  });
});

describe('SubscriptionSection', () => {
  const ACTIVE_STATUS: PremiumStatus = {
    active: true,
    tier: 'gold',
    cadence: 'monthly',
    provider: 'stripe',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    manageUrl: 'https://billing.example.com/portal',
  };

  const INACTIVE_STATUS: PremiumStatus = {
    active: false,
    tier: null,
    cadence: null,
    provider: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    manageUrl: null,
  };

  it('shows the tier and calls onManage when active', async () => {
    const { SubscriptionSection } = await import('../SubscriptionSection');
    const onManage = vi.fn();
    render(
      <SubscriptionSection
        status={ACTIVE_STATUS}
        subscriptionsEnabled={true}
        onManage={onManage}
        onSubscribe={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Gold');
    click('inicio-subscription-active');
    expect(onManage).toHaveBeenCalled();
  });

  it('shows the upsell and calls onSubscribe when inactive and the platform gate is on', async () => {
    const { SubscriptionSection } = await import('../SubscriptionSection');
    const onSubscribe = vi.fn();
    render(
      <SubscriptionSection
        status={INACTIVE_STATUS}
        subscriptionsEnabled={true}
        onManage={vi.fn()}
        onSubscribe={onSubscribe}
      />,
    );
    expect(container.textContent).toContain(inicioCopy.cards.subscribeUpsell);
    click('inicio-subscription-upsell');
    expect(onSubscribe).toHaveBeenCalled();
  });

  // Fix (final review, Critical 1): /inicio is the platform gate's own
  // redirect target, so this pill (which pushes /assinaturas) must not
  // render when the gate is off — it would bounce a gated member straight
  // back to /inicio. Same standard as MinhaAssinaturaScreen (Task 10): a
  // button that bounces is worse than no button.
  it('renders null when inactive and the platform gate is off', async () => {
    const { SubscriptionSection } = await import('../SubscriptionSection');
    render(
      <SubscriptionSection
        status={INACTIVE_STATUS}
        subscriptionsEnabled={false}
        onManage={vi.fn()}
        onSubscribe={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders null when status is null', async () => {
    const { SubscriptionSection } = await import('../SubscriptionSection');
    render(
      <SubscriptionSection
        status={null}
        subscriptionsEnabled={true}
        onManage={vi.fn()}
        onSubscribe={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

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

describe('BoxSection', () => {
  it('renders the section and the mapped status when premium is active and box is present', () => {
    render(<BoxSection box={BOX} isPremiumActive={true} onPress={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.sections.box);
    expect(container.textContent).toContain(caixaCopy.history.status.open);
    expect(container.querySelector('[data-testid="inicio-box"]')).not.toBeNull();
  });

  it('renders null when isPremiumActive is false even though box is present', () => {
    render(<BoxSection box={BOX} isPremiumActive={false} onPress={vi.fn()} />);
    // Catches: checking box first and isPremiumActive second (or not at
    // all), which would leak the monthly-box teaser to non-subscribers.
    expect(container.firstChild).toBeNull();
  });

  it('renders null when box is null even though premium is active', () => {
    render(<BoxSection box={null} isPremiumActive={true} onPress={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = vi.fn();
    render(<BoxSection box={BOX} isPremiumActive={true} onPress={onPress} />);
    click('inicio-box');
    expect(onPress).toHaveBeenCalled();
  });
});

describe('QuickAccessSection', () => {
  it('renders the four quick-access labels', () => {
    render(<QuickAccessSection onNavigate={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.quickAccess.events);
    expect(container.textContent).toContain(inicioCopy.quickAccess.tickets);
    expect(container.textContent).toContain(inicioCopy.quickAccess.garage);
    expect(container.textContent).toContain(inicioCopy.quickAccess.store);
  });

  it('navigates to /events from the events tile', () => {
    const onNavigate = vi.fn();
    render(<QuickAccessSection onNavigate={onNavigate} />);
    click('inicio-quick-events');
    expect(onNavigate).toHaveBeenCalledWith('/events');
  });

  it('navigates to /tickets from the tickets tile', () => {
    const onNavigate = vi.fn();
    render(<QuickAccessSection onNavigate={onNavigate} />);
    click('inicio-quick-tickets');
    // Catches: pointing the tickets tile at the wrong path (e.g. /events).
    expect(onNavigate).toHaveBeenCalledWith('/tickets');
  });

  it('navigates to /garage from the garage tile', () => {
    const onNavigate = vi.fn();
    render(<QuickAccessSection onNavigate={onNavigate} />);
    click('inicio-quick-garage');
    expect(onNavigate).toHaveBeenCalledWith('/garage');
  });

  it('navigates to /store from the store tile', () => {
    const onNavigate = vi.fn();
    render(<QuickAccessSection onNavigate={onNavigate} />);
    click('inicio-quick-store');
    expect(onNavigate).toHaveBeenCalledWith('/store');
  });
});
