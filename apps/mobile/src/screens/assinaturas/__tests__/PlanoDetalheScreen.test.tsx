// @vitest-environment jsdom
//
// PlanoDetalheScreen tests. getPremiumPlan is mocked; the CTA navigates to the
// contratação screen (which owns the real checkout seam) — no purchase is
// made from this screen.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PremiumPlan, PremiumPlanDetailResponse } from '@ccc/shared/premium-catalog';
import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';
import { assinaturasCopy } from '~/copy/assinaturas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getPremiumPlan = vi.fn<(slug: string) => Promise<PremiumPlanDetailResponse>>();
// Backs the real usePremiumSubscription hook (not mocked directly — the hook
// itself is exercised here, only its API call is stubbed). Same technique as
// ContratarScreen.test.tsx.
const getMyPremiumSubscription = vi.fn<() => Promise<MySubscriptionResponse>>();
const routerPush = vi.fn();

// Final review C2 — the caixa paywall copy must not promise a box the build
// can't assemble. Mutable so a single test can flip it off (read at render
// time, not import time).
const caixaFlag = { enabled: true };
vi.mock('~/screens/caixa/caixa-enabled', () => ({
  isCaixaBuildEnabled: () => caixaFlag.enabled,
}));

vi.mock('~/api/premium-catalog', () => ({
  getPremiumPlan: (slug: string) => getPremiumPlan(slug),
  getMyPremiumSubscription: () => getMyPremiumSubscription(),
}));

vi.mock('~/lib/premium-runtime', () => ({ PREMIUM_BILLING_ENABLED: true }));

// The real usePremiumSubscription hook is exercised here (only its API call
// is stubbed above). Its module imports `ApiError` from '~/api/client', whose
// real file pulls in `expo-constants` → `expo-modules-core`, which reads
// `__DEV__` at import time — undefined under this file's minimal jsdom setup.
// A real ApiError class (not vi.fn()) so `err instanceof ApiError` still
// behaves like production.
vi.mock('~/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

const NO_SUBSCRIPTION: MySubscriptionResponse = {
  active: false,
  tier: null,
  planSlug: null,
  planName: null,
  planDescription: null,
  cadence: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  status: null,
  provider: null,
  baseAmountCents: 0,
  addonsAmountCents: 0,
  totalAmountCents: 0,
  currency: 'BRL',
  addons: [],
  benefits: [],
};

// A tela passou a ler `useSafeAreaInsets` (main), e o provider real nao existe
// sob o jsdom minimo deste arquivo.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
  return { ArrowLeft: icon, Check: icon };
});

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace: vi.fn(), push: routerPush },
}));

const SAMPLE: PremiumPlan = {
  tier: 'gold',
  slug: 'fundador',
  name: 'Fundador',
  description: 'O plano mais completo.',
  sortOrder: 2,
  prices: [{ cadence: 'monthly', baseAmountCents: 149000, currency: 'BRL' }],
  benefits: [
    { label: 'Concierge dedicado', sortOrder: 1 },
    { label: 'Acesso 24h', sortOrder: 0 },
  ],
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PlanoDetalheScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    routerPush.mockClear();
    caixaFlag.enabled = true;
    getPremiumPlan.mockReset();
    // Flattened, not nested under `plan` (final review, Important 2) — the
    // real route now returns the plan fields at the top level.
    getPremiumPlan.mockResolvedValue({ ...SAMPLE, subscriptionsEnabled: true });
    getMyPremiumSubscription.mockReset();
    getMyPremiumSubscription.mockResolvedValue(NO_SUBSCRIPTION);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async (slug: string | undefined = 'fundador') => {
    const { default: PlanoDetalheScreen } = await import('../PlanoDetalheScreen');
    await act(async () => {
      root.render(<PlanoDetalheScreen slug={slug} />);
      await flush();
    });
  };

  it('renders the fetched plan with price and ordered benefits', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('Fundador');
    expect(text).toContain('OURO');
    expect(text).toContain('1.490,00');
    expect(text).toContain('O plano mais completo.');
    expect(text.indexOf('Acesso 24h')).toBeLessThan(text.indexOf('Concierge dedicado'));
  });

  it('navigates to the contratação screen (no purchase here) when Assinar is tapped', async () => {
    await renderScreen();
    const cta = container.querySelector('[data-testid="detalhe-assinar"]') as HTMLElement | null;
    if (!cta) throw new Error('CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith('/assinaturas/contratar?slug=fundador');
  });

  it('does not render the Assinar CTA when the platform gate is off', async () => {
    getPremiumPlan.mockResolvedValue({ ...SAMPLE, subscriptionsEnabled: false });
    await renderScreen();
    expect(container.querySelector('[data-testid="detalhe-assinar"]')).toBeNull();
    // The rest of the plan detail still renders — only the CTA is gated.
    expect(container.textContent ?? '').toContain('Fundador');
  });

  it('shows a not-found state when the plan is missing', async () => {
    getPremiumPlan.mockRejectedValue(new Error('404'));
    await renderScreen();
    expect(container.textContent ?? '').toContain('Não foi possível carregar');
  });

  // Final review C2 — same caixa gate as ContratarScreen. Both directions
  // pinned here: renders when the build can assemble the box, renders
  // nothing at all (no stray heading, no empty container) when it can't.
  it('renders the caixa copy when the caixa build flag is on', async () => {
    caixaFlag.enabled = true;
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain(assinaturasCopy.caixa.title);
    expect(text).toContain(assinaturasCopy.caixa.delivery);
  });

  it('renders no caixa copy at all when the caixa build flag is off', async () => {
    caixaFlag.enabled = false;
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).not.toContain(assinaturasCopy.caixa.title);
    expect(text).not.toContain(assinaturasCopy.caixa.body);
    expect(text).not.toContain(assinaturasCopy.caixa.delivery);
  });

  // Task 8 — same gate as PlanosScreen/ContratarScreen applied at the CTA
  // destination. Own plan: nothing to contract, no CTA at all.
  it('offers no CTA on the members own current plan', async () => {
    getMyPremiumSubscription.mockResolvedValue({
      ...NO_SUBSCRIPTION,
      active: true,
      status: 'active',
      planSlug: 'fundador',
    });
    await renderScreen();
    expect(container.querySelector('[data-testid="detalhe-assinar"]')).toBeNull();
    expect(container.textContent ?? '').toContain('Fundador');
  });

  // A different plan, with the member's OWN membership in good standing:
  // the CTA sends them to the plan-change screen, not to a contratar flow
  // that would just 409 AlreadySubscribed.
  it('sends an eligible member to alterar instead of contratar for a different plan', async () => {
    getMyPremiumSubscription.mockResolvedValue({
      ...NO_SUBSCRIPTION,
      active: true,
      status: 'active',
      planSlug: 'estrada',
    });
    await renderScreen();
    const cta = container.querySelector('[data-testid="detalhe-assinar"]') as HTMLElement | null;
    if (!cta) throw new Error('CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(routerPush).toHaveBeenCalledWith('/assinaturas/alterar?slug=fundador');
  });

  // past_due keeps the regular contratar → 409 → Stripe portal exit — the
  // same reason the gate excludes it everywhere else.
  it('still sends a past_due member to contratar, not alterar', async () => {
    getMyPremiumSubscription.mockResolvedValue({
      ...NO_SUBSCRIPTION,
      active: true,
      status: 'past_due',
      planSlug: 'estrada',
    });
    await renderScreen();
    const cta = container.querySelector('[data-testid="detalhe-assinar"]') as HTMLElement | null;
    if (!cta) throw new Error('CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(routerPush).toHaveBeenCalledWith('/assinaturas/contratar?slug=fundador');
  });
});
