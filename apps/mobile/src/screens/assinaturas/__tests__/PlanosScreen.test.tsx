// @vitest-environment jsdom
//
// PlanosScreen tests. Data now comes from usePremiumPlans / usePremiumAddonModules
// — both hooks are mocked so the screen can be driven through loading / error /
// empty / populated states. RN primitives become plain HTML tags for jsdom.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PremiumAddonModule, PremiumPlan } from '@jdm/shared/premium-catalog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const push = vi.fn();

const hookState = vi.hoisted(() => ({
  plans: {
    plans: [] as PremiumPlan[],
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
  modules: {
    modules: [] as PremiumAddonModule[],
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
}));

vi.mock('~/hooks/usePremiumPlans', () => ({ usePremiumPlans: () => hookState.plans }));
vi.mock('~/hooks/usePremiumAddonModules', () => ({
  usePremiumAddonModules: () => hookState.modules,
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
  router: { canGoBack: () => true, back: vi.fn(), replace: vi.fn(), push },
}));

const plan = (over: Partial<PremiumPlan> & Pick<PremiumPlan, 'tier' | 'slug' | 'name'>): PremiumPlan => ({
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
    benefits: [{ label: 'Concierge', sortOrder: 1 }, { label: 'Clube 24h', sortOrder: 0 }],
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
    hookState.plans = {
      plans: SAMPLE_PLANS,
      loading: false,
      error: false,
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
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async () => {
    const { default: PlanosScreen } = await import('../PlanosScreen');
    await act(async () => {
      root.render(<PlanosScreen />);
      await flush();
    });
  };

  it('shows the loading state', async () => {
    hookState.plans = { plans: [], loading: true, error: false, refresh: () => Promise.resolve() };
    await renderScreen();
    expect(container.textContent ?? '').toContain('Carregando');
  });

  it('shows the error state with a retry control', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    hookState.plans = { plans: [], loading: false, error: true, refresh };
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
    hookState.plans = { plans: [], loading: false, error: false, refresh: () => Promise.resolve() };
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
});
