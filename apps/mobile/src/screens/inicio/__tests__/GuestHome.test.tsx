// @vitest-environment jsdom
//
// GuestHome é a vitrine do não logado. O que vale pinar: o header com o
// botão ENTRAR desvia pelo login carregando next=/welcome, os nove blocos
// da emenda de escopo renderizam com dados do backend (useHomeContent,
// useClubStats, eventos próximos, loja, carros confirmados), os CTAs
// desviam pelo login, seção vazia não deixa cabeçalho órfão, loading e erro
// TOTAL (useHomeContent) têm tratamento próprio, e as falhas complementares
// (useClubStats, eventos, loja, carros confirmados) nunca derrubam o resto
// da tela. Guarda de vazamento nos dois sentidos: nenhuma seção do membro
// aparece aqui.
//
// Per-file `vi.mock('react-native', ...)` e `vi.mock('expo-linear-gradient',
// ...)` no mesmo padrão de MemberHome.test.tsx / HeroSection.test.tsx: não
// há mock compartilhado de react-native neste plano.

import type { ConfirmedCarsResponse, EventSummary } from '@ccc/shared/events';
import type { HomeContentResponse } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

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

const routerPush = vi.fn();

const hookState = vi.hoisted(() => ({
  home: {
    content: null as HomeContentResponse | null,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
  clubStats: {
    stats: null as { members: number; events: number; cars: number } | null,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
  storeProducts: {
    items: [] as unknown[],
    nextCursor: null as string | null,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
}));

const { listEvents, getConfirmedCars } = vi.hoisted(() => ({
  listEvents: vi.fn(),
  getConfirmedCars: vi.fn(),
}));

vi.mock('~/hooks/useHomeContent', () => ({
  useHomeContent: () => hookState.home,
}));
vi.mock('~/hooks/useClubStats', () => ({
  useClubStats: () => hookState.clubStats,
}));
vi.mock('~/hooks/useStoreProducts', () => ({
  useStoreProducts: () => hookState.storeProducts,
}));
vi.mock('~/api/events', () => ({
  listEvents,
  getConfirmedCars,
}));
vi.mock('expo-router', () => ({
  router: { push: (href: string) => routerPush(href) },
  useRouter: () => ({ push: (href: string) => routerPush(href) }),
}));

const { GuestHome } = await import('../GuestHome');

const CONTENT: HomeContentResponse = {
  hero: {
    title: 'DIRIGIR. CONECTAR. PERTENCER.',
    subtitle: 'O clube de carros de Curitiba.',
    bannerUrl: null,
  },
  institutional: {
    title: 'A Casa',
    body: 'Um clubhouse automotivo privado em Curitiba.',
    imageUrl: null,
  },
  benefits: [
    { icon: 'calendar', title: 'Eventos exclusivos', description: null, sortOrder: 0 },
  ],
  highlights: [
    {
      kind: 'event',
      title: 'Próximos encontros',
      subtitle: null,
      imageUrl: null,
      linkPath: '/events',
      sortOrder: 0,
    },
  ],
  plans: [
    {
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      description: null,
      fromAmountCents: 49900,
      currency: 'BRL',
      benefits: ['Day Use ilimitado'],
      sortOrder: 0,
    },
  ],
};

const UPCOMING_EVENT: EventSummary = {
  id: 'evt_1',
  slug: 'trackday-2026',
  title: 'Trackday SP',
  coverUrl: null,
  startsAt: '2026-09-10T13:00:00.000Z',
  endsAt: '2026-09-10T18:00:00.000Z',
  venueName: 'Autódromo',
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'drift',
  status: 'published',
};

const CONFIRMED: ConfirmedCarsResponse = {
  items: [
    {
      ref: 'car_1',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      photoUrl: null,
      isPremiumActive: false,
    },
  ],
  total: 1,
};

let container: HTMLDivElement;
let root: Root;

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  routerPush.mockReset();
  listEvents.mockReset();
  getConfirmedCars.mockReset();
  listEvents.mockResolvedValue({ items: [UPCOMING_EVENT], nextCursor: null });
  getConfirmedCars.mockResolvedValue(CONFIRMED);
  hookState.home = {
    content: CONTENT,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  };
  hookState.clubStats = {
    stats: { members: 120, events: 8, cars: 95 },
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  };
  hookState.storeProducts = {
    items: [
      {
        id: 'p1',
        slug: 'camiseta',
        title: 'Camiseta Casa',
        shortDescription: null,
        canShip: true,
        canPickup: false,
        coverImageUrl: null,
        productType: { id: 'pt1', slug: 'roupas', name: 'Roupas', description: null },
        priceRange: {
          minPriceCents: 8900,
          maxPriceCents: 8900,
          minDisplayPriceCents: 9200,
          maxDisplayPriceCents: 9200,
          devFeePercent: 3,
          currency: 'BRL',
        },
        inStock: true,
      },
    ],
    nextCursor: null,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  };
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
});

const render = async () => {
  await act(async () => {
    root.render(<GuestHome />);
    await flush();
    await flush();
  });
};

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('GuestHome — happy path', () => {
  it('renders the header, hero, benefits, club stats, CTAs, plans and highlights', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('CASA CAR CLUB');
    expect(text).toContain(inicioCopy.cta.login);
    expect(text).toContain('DIRIGIR. CONECTAR. PERTENCER.');
    expect(text).toContain('A Casa');
    expect(text).toContain(inicioCopy.sections.benefits);
    expect(text).toContain(inicioCopy.sections.clubStats);
    expect(text).toContain(inicioCopy.cta.signup);
    expect(text).toContain(inicioCopy.cta.subscribe);
    expect(text).toContain(inicioCopy.sections.plans);
    expect(text).toContain(inicioCopy.sections.highlights);
  });

  // Fix round 1 (Important 1): a reviewer moved <ClubStatsSection> from
  // position 4 to below <StoreTeaserSection> and every other test in this
  // file still passed. Pin the actual vertical order, not just presence,
  // the same way MemberHome.test.tsx does (indexOf position markers).
  it('renders the nine blocks in the addendum-specified order', async () => {
    await render();
    const text = container.textContent ?? '';
    const markers = [
      'CASA CAR CLUB', // 1. AppHeader
      'DIRIGIR. CONECTAR. PERTENCER.', // 2. HeroSection
      inicioCopy.sections.benefits, // 3. BenefitsSection
      inicioCopy.sections.clubStats, // 4. ClubStatsSection
      inicioCopy.cta.signup, // 5. CtaSection
      inicioCopy.sections.plans, // 6. PlansSection
      inicioCopy.sections.highlights, // 7. HighlightsSection
      inicioCopy.sections.store, // 8. StoreTeaserSection
      inicioCopy.sections.confirmedCars, // 9. ConfirmedCarsSection
    ];
    const indices = markers.map((m) => text.indexOf(m));
    indices.forEach((idx, i) => {
      expect(idx, `marker not found: ${markers[i]}`).toBeGreaterThan(-1);
    });
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1] ?? -1);
    }
  });

  it('renders both the fetched upcoming event and the curated highlight', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Trackday SP');
    expect(text).toContain('Próximos encontros');
  });

  it('renders the store teaser section', async () => {
    await render();
    expect(container.textContent).toContain(inicioCopy.sections.store);
    expect(container.textContent).toContain('Camiseta Casa');
  });

  it('renders the confirmed cars section for the first upcoming event', async () => {
    await render();
    expect(getConfirmedCars).toHaveBeenCalledWith('trackday-2026');
    expect(container.textContent).toContain(inicioCopy.sections.confirmedCars);
    expect(container.textContent).toContain('Toyota');
  });

  it('the header ENTRAR button navigates to login carrying next=/welcome', async () => {
    await render();
    click('inicio-guest-login');
    expect(routerPush).toHaveBeenCalledTimes(1);
    const href = routerPush.mock.calls[0]?.[0] as string;
    expect(href).toContain('/login');
    expect(href).toContain(encodeURIComponent('/welcome'));
  });

  it('sends the create-account CTA straight to signup', async () => {
    await render();
    click('inicio-cta-signup');
    expect(routerPush).toHaveBeenCalledWith('/signup');
  });

  it('routes the subscribe CTA through login carrying /assinaturas', async () => {
    await render();
    click('inicio-cta-subscribe');
    expect(routerPush).toHaveBeenCalledTimes(1);
    const href = routerPush.mock.calls[0]?.[0] as string;
    expect(href).toContain('/login');
    expect(href).toContain('assinaturas');
  });

  it('routes a plan card through login as well', async () => {
    await render();
    click('inicio-plan-ouro');
    const href = routerPush.mock.calls[0]?.[0] as string;
    expect(href).toContain('/login');
    expect(href).toContain('assinaturas');
  });

  it('never calls listEvents more than once across re-renders (stable effect deps)', async () => {
    await render();
    await act(async () => {
      root.render(<GuestHome />);
      await flush();
    });
    // Fix round 1 (Minor 5): this assertion IS the loop guard, not
    // incidental filler — do not delete it to "simplify" the suite. Mutating
    // the effect's dependency array in GuestHome.tsx from `[]` to something
    // with a fresh identity every render (e.g. `[{}]`) reproduces the
    // task-9/task-11 infinite-fetch trap empirically: this assertion fails
    // with "expected spy to be called 1 times, but got 3 times", and the
    // sibling test below ("keeps the screen up ... when the events fetch
    // fails") times out at 5000ms waiting on the resulting runaway retry
    // loop — the same shape a reviewer traced to a V8 heap crash on task-11.
    expect(listEvents).toHaveBeenCalledTimes(1);
  });
});

describe('GuestHome — total failure (useHomeContent)', () => {
  it('shows a skeleton while loading and no section labels', async () => {
    hookState.home = {
      content: null,
      loading: true,
      error: false,
      refresh: () => Promise.resolve(),
    };
    await render();
    expect(container.querySelector('[data-testid="inicio-skeleton"]')).not.toBeNull();
    expect(container.textContent).not.toContain(inicioCopy.sections.plans);
    // Fix round 1 (Important 2): the header, and its ENTRAR login entry
    // point, is the only way back into the app from the anonymous home's
    // first screen. It must survive the total-failure gate, not just the
    // happy path — a reviewer wrapped <AppHeader> in `{content ? … : null}`
    // and every other test here still passed.
    expect(container.textContent).toContain(inicioCopy.cta.login);
    expect(container.querySelector('[data-testid="inicio-guest-login"]')).not.toBeNull();
  });

  it('shows the error state with a retry that calls refresh', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    hookState.home = { content: null, loading: false, error: true, refresh };
    await render();
    expect(container.textContent).toContain(inicioCopy.states.errorTitle);
    click('inicio-error-retry');
    expect(refresh).toHaveBeenCalledTimes(1);
    // Fix round 1 (Important 2): same guard as the loading test above —
    // `/api/home-content` being down must not take the ENTRAR button with
    // it, or the anonymous visitor loses the app's only login entry point.
    expect(container.textContent).toContain(inicioCopy.cta.login);
    expect(container.querySelector('[data-testid="inicio-guest-login"]')).not.toBeNull();
  });

  it('omits a section entirely when its list is empty', async () => {
    hookState.home = {
      content: { ...CONTENT, plans: [], highlights: [] },
      loading: false,
      error: false,
      refresh: () => Promise.resolve(),
    };
    listEvents.mockResolvedValue({ items: [], nextCursor: null });
    await render();
    expect(container.textContent).toContain(inicioCopy.sections.benefits);
    expect(container.textContent).not.toContain(inicioCopy.sections.plans);
    expect(container.textContent).not.toContain(inicioCopy.sections.highlights);
  });
});

describe('GuestHome — complementary failures never take down the rest of the screen', () => {
  it('keeps the rest of the screen when club stats fails', async () => {
    hookState.clubStats = {
      stats: null,
      loading: false,
      error: true,
      refresh: () => Promise.resolve(),
    };
    await render();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.clubStats);
    expect(text).toContain(inicioCopy.sections.plans);
    expect(text).toContain(inicioCopy.cta.signup);
  });

  it('keeps the screen up, hides confirmed cars, when the events fetch fails', async () => {
    listEvents.mockRejectedValue(new Error('network error'));
    await render();
    const text = container.textContent ?? '';
    // Curated highlight still renders even though the real-event fetch failed.
    expect(text).toContain('Próximos encontros');
    expect(text).not.toContain('Trackday SP');
    // No event slug means ConfirmedCarsSection never calls the API.
    expect(getConfirmedCars).not.toHaveBeenCalled();
    expect(text).toContain(inicioCopy.sections.plans);
    expect(text).toContain(inicioCopy.sections.store);
  });

  it('keeps the rest of the screen when the store teaser fails', async () => {
    hookState.storeProducts = {
      items: [],
      nextCursor: null,
      loading: false,
      error: true,
      refresh: () => Promise.resolve(),
    };
    await render();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.store);
    expect(text).toContain(inicioCopy.sections.plans);
    expect(text).toContain(inicioCopy.sections.highlights);
  });

  it('keeps the rest of the screen when confirmed cars fails', async () => {
    getConfirmedCars.mockRejectedValue(new Error('network error'));
    await render();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.confirmedCars);
    expect(text).toContain(inicioCopy.sections.plans);
    expect(text).toContain(inicioCopy.sections.store);
  });
});

describe('GuestHome — member-state leak guard', () => {
  it('never renders any member-only section', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.myTickets);
    expect(text).not.toContain(inicioCopy.sections.myGarage);
    expect(text).not.toContain(inicioCopy.sections.quickAccess);
  });

  // Fix round 1 (Minor 4): the guard above only ran against the happy path,
  // so a member section leaking into the loading or error branch would not
  // have been caught. Same finding Task 11 got and fixed with a second
  // scenario; covering both branches here, not just error.
  it('never renders any member-only section while loading', async () => {
    hookState.home = {
      content: null,
      loading: true,
      error: false,
      refresh: () => Promise.resolve(),
    };
    await render();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.myTickets);
    expect(text).not.toContain(inicioCopy.sections.myGarage);
    expect(text).not.toContain(inicioCopy.sections.quickAccess);
  });

  it('never renders any member-only section in the error state', async () => {
    hookState.home = {
      content: null,
      loading: false,
      error: true,
      refresh: () => Promise.resolve(),
    };
    await render();
    const text = container.textContent ?? '';
    expect(text).not.toContain(inicioCopy.sections.myTickets);
    expect(text).not.toContain(inicioCopy.sections.myGarage);
    expect(text).not.toContain(inicioCopy.sections.quickAccess);
  });
});
