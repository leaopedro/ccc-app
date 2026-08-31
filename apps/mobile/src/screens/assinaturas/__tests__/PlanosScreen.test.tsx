// @vitest-environment jsdom
//
// PlanosScreen tests. Data now comes from usePremiumPlans / usePremiumAddonModules
// — both hooks are mocked so the screen can be driven through loading / error /
// empty / populated states. RN primitives become plain HTML tags for jsdom.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PremiumAddonModule, PremiumPlan } from '@ccc/shared/premium-catalog';
import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const push = vi.fn();
const replace = vi.fn();

const hookState = vi.hoisted(() => ({
  plans: {
    plans: [] as PremiumPlan[],
    loading: false,
    error: false,
    subscriptionsEnabled: true,
    refresh: () => Promise.resolve(),
  },
  modules: {
    modules: [] as PremiumAddonModule[],
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
  subscription: {
    subscription: null as MySubscriptionResponse | null,
    loading: false,
  },
}));

vi.mock('~/hooks/usePremiumPlans', () => ({ usePremiumPlans: () => hookState.plans }));
vi.mock('~/hooks/usePremiumAddonModules', () => ({
  usePremiumAddonModules: () => hookState.modules,
}));
vi.mock('~/hooks/usePremiumSubscription', () => ({
  usePremiumSubscription: () => hookState.subscription,
}));

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
        contentContainerStyle,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void className;
      void hitSlop;
      void pointerEvents;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
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
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactMod.createElement(tag, { ref, ...props }),
    );
  return {
    default: make('svg'),
    Svg: make('svg'),
    Defs: make('defs'),
    RadialGradient: make('radialgradient'),
    Rect: make('rect'),
    Stop: make('stop'),
  };
});

vi.mock('expo-linear-gradient', async () => {
  const ReactMod = await import('react');
  return {
    LinearGradient: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { colors, start, end, style, ...rest } = props;
      void colors;
      void start;
      void end;
      void style;
      return ReactMod.createElement('div', { ref, ...rest });
    }),
  };
});

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { ArrowLeft: icon, Check: icon, SprayCan: icon, Wrench: icon };
});

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace, push },
}));

const plan = (
  over: Partial<PremiumPlan> & Pick<PremiumPlan, 'tier' | 'slug' | 'name'>,
): PremiumPlan => ({
  description: null,
  sortOrder: 0,
  prices: [{ cadence: 'monthly', baseAmountCents: 49000, currency: 'BRL' }],
  benefits: [{ label: 'Acesso ao clube', sortOrder: 0 }],
  ...over,
});

const SAMPLE_PLANS: PremiumPlan[] = [
  plan({
    tier: 'bronze',
    slug: 'ingresso',
    name: 'Ingresso',
    prices: [{ cadence: 'monthly', baseAmountCents: 49000, currency: 'BRL' }],
    benefits: [{ label: 'Acesso comercial', sortOrder: 0 }],
  }),
  plan({
    tier: 'silver',
    slug: 'estrada',
    name: 'Estrada',
    prices: [{ cadence: 'monthly', baseAmountCents: 89000, currency: 'BRL' }],
    benefits: [{ label: 'Prioridade em eventos', sortOrder: 0 }],
  }),
  plan({
    tier: 'gold',
    slug: 'fundador',
    name: 'Fundador',
    prices: [{ cadence: 'monthly', baseAmountCents: 149000, currency: 'BRL' }],
    benefits: [
      { label: 'Concierge', sortOrder: 1 },
      { label: 'Clube 24h', sortOrder: 0 },
    ],
  }),
];

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PlanosScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    push.mockClear();
    replace.mockClear();
    hookState.plans = {
      plans: SAMPLE_PLANS,
      loading: false,
      error: false,
      subscriptionsEnabled: true,
      refresh: () => Promise.resolve(),
    };
    hookState.modules = {
      modules: [
        {
          key: 'detailing',
          name: 'Detailing',
          description: '3 acessos/mês',
          monthlyDeltaCents: 15000,
          currency: 'BRL',
          quotaPerCycle: 3,
          quotaUnit: 'access',
          sortOrder: 0,
        },
      ],
      loading: false,
      error: false,
      refresh: () => Promise.resolve(),
    };
    hookState.subscription = { subscription: null, loading: false };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async (showAll = false) => {
    const { default: PlanosScreen } = await import('../PlanosScreen');
    await act(async () => {
      root.render(<PlanosScreen showAll={showAll} />);
      await flush();
    });
  };

  it('shows the loading state', async () => {
    hookState.plans = {
      plans: [],
      loading: true,
      error: false,
      subscriptionsEnabled: true,
      refresh: () => Promise.resolve(),
    };
    await renderScreen();
    expect(container.textContent ?? '').toContain('Carregando');
  });

  it('shows the error state with a retry control', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    hookState.plans = {
      plans: [],
      loading: false,
      error: true,
      subscriptionsEnabled: true,
      refresh,
    };
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('Não foi possível carregar os planos.');
    const retry = container.querySelector('[data-testid="planos-retry"]') as HTMLElement | null;
    if (!retry) throw new Error('retry not rendered');
    await act(async () => {
      retry.click();
      await flush();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no plans', async () => {
    hookState.plans = {
      plans: [],
      loading: false,
      error: false,
      subscriptionsEnabled: true,
      refresh: () => Promise.resolve(),
    };
    await renderScreen();
    expect(container.textContent ?? '').toContain('Nenhum plano disponível');
  });

  it('renders the three tiers from the hook with names and formatted prices', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('BRONZE');
    expect(text).toContain('PRATA');
    expect(text).toContain('OURO');
    expect(text).toContain('Ingresso');
    expect(text).toContain('Estrada');
    expect(text).toContain('Fundador');
    expect(text).toContain('490,00');
    expect(text).toContain('890,00');
    expect(text).toContain('1.490,00');
    // gold tier is recommended
    expect(text).toContain('RECOMENDADO');
    // gold benefits render in sortOrder (Clube 24h before Concierge)
    expect(text.indexOf('Clube 24h')).toBeLessThan(text.indexOf('Concierge'));
  });

  it('renders add-on modules from the hook', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('MÓDULOS ADICIONAIS');
    expect(text).toContain('Detailing');
    expect(text).toContain('150,00');
  });

  it('does not render per-plan Assinar CTAs when the platform gate is off', async () => {
    hookState.plans = {
      plans: SAMPLE_PLANS,
      loading: false,
      error: false,
      subscriptionsEnabled: false,
      refresh: () => Promise.resolve(),
    };
    await renderScreen();
    expect(container.querySelector('[data-testid="assinar-gold"]')).toBeNull();
    expect(container.querySelector('[data-testid="assinar-bronze"]')).toBeNull();
    // Cards themselves still render — browsing plans is unaffected.
    expect(container.textContent ?? '').toContain('Fundador');
  });

  it('navigates to the plan detail when a plan CTA is tapped', async () => {
    await renderScreen();
    const cta = container.querySelector('[data-testid="assinar-gold"]') as HTMLElement | null;
    if (!cta) throw new Error('gold CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(push).toHaveBeenCalledWith('/assinaturas/fundador');
  });

  const ACTIVE_SUBSCRIPTION: MySubscriptionResponse = {
    active: true,
    tier: 'gold',
    planSlug: 'fundador',
    planName: 'Fundador',
    planDescription: null,
    cadence: 'monthly',
    currentPeriodEnd: '2026-08-22T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    baseAmountCents: 149000,
    addonsAmountCents: 0,
    totalAmountCents: 149000,
    currency: 'BRL',
    addons: [],
    benefits: [],
  };

  it('redirects an active subscriber to Minha Assinatura instead of showing plans', async () => {
    hookState.subscription = { subscription: ACTIVE_SUBSCRIPTION, loading: false };
    await renderScreen();
    expect(replace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  it('does not redirect and still shows the plan list when ?all=1 is set', async () => {
    hookState.subscription = { subscription: ACTIVE_SUBSCRIPTION, loading: false };
    await renderScreen(true);
    expect(replace).not.toHaveBeenCalled();
    const text = container.textContent ?? '';
    expect(text).toContain('Ingresso');
    expect(text).toContain('Fundador');
  });

  it('does not redirect a member without an active subscription', async () => {
    hookState.subscription = {
      subscription: { ...ACTIVE_SUBSCRIPTION, active: false },
      loading: false,
    };
    await renderScreen();
    expect(replace).not.toHaveBeenCalled();
    expect(container.textContent ?? '').toContain('Ingresso');
  });

  it('does not flash the plan list while the subscription status is still loading', async () => {
    // Plans have already resolved (loading: false) but subscription status has
    // not — the screen must keep showing the spinner, not the list, until both
    // are known. Regresses the exact defect this task fixes: gating the
    // screen's loading state on `loading` alone (dropping `subLoading`) would
    // let this render the list one frame before any redirect could happen.
    hookState.subscription = { subscription: null, loading: true };
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('Carregando');
    expect(text).not.toContain('Ingresso');
    expect(text).not.toContain('BRONZE');
    expect(replace).not.toHaveBeenCalled();
  });
});
