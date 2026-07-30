// @vitest-environment jsdom
//
// ContratarScreen tests. This screen is the highest-risk surface in the
// assinaturas module: it owns package-total math driven by mutable Set
// state, the anti-double-submit guard around a real payment call, and the
// branching over all five startPremiumCheckout outcomes plus the iOS seam.
// Everything a real member's money depends on is pinned here rather than
// left to hand-tracing.
//
// getPremiumPlan, usePremiumAddonModules, startPremiumCheckout,
// pollSubscriptionActive and showToast are all mocked — pollSubscriptionActive
// especially, since the real one sleeps 2s per attempt (up to 15 attempts).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PremiumAddonModule, PremiumPlan } from '@ccc/shared/premium-catalog';
import type { CheckoutOutcome } from '~/screens/assinaturas/checkout';
import { assinaturasCopy } from '~/copy/assinaturas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getPremiumPlan = vi.fn<(slug: string) => Promise<PremiumPlan>>();
const startPremiumCheckout = vi.fn<(input: unknown) => Promise<CheckoutOutcome>>();
const pollSubscriptionActive = vi.fn<() => Promise<boolean>>();
const showToast = vi.fn();
const routerReplace = vi.fn();
const routerBack = vi.fn();

// Mutable so each test can flip OS before rendering — same technique as
// checkout.test.ts (Platform.OS is read at render/call time, not at import
// time, so mutating this object before `renderScreen()` is enough).
const platform = { OS: 'android' as string };

const hookState = vi.hoisted(() => ({
  modules: {
    modules: [] as PremiumAddonModule[],
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
}));

vi.mock('~/api/premium-catalog', () => ({
  getPremiumPlan: (slug: string) => getPremiumPlan(slug),
}));

vi.mock('~/hooks/usePremiumAddonModules', () => ({
  usePremiumAddonModules: () => hookState.modules,
}));

vi.mock('~/screens/assinaturas/checkout', () => ({
  startPremiumCheckout: (input: unknown) => startPremiumCheckout(input),
}));

vi.mock('~/screens/assinaturas/poll-subscription', () => ({
  pollSubscriptionActive: () => pollSubscriptionActive(),
}));

vi.mock('~/lib/toast', () => ({
  showToast: (message: string) => showToast(message),
}));

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: routerBack, replace: routerReplace, push: vi.fn() },
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
        accessibilityState,
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
      void accessibilityState;
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
    Platform: platform,
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
  return { ArrowLeft: icon };
});

const PLAN: PremiumPlan = {
  tier: 'gold',
  slug: 'fundador',
  name: 'Fundador',
  description: null,
  sortOrder: 0,
  prices: [{ cadence: 'monthly', baseAmountCents: 100000, currency: 'BRL' }],
  benefits: [],
};

const MODULE: PremiumAddonModule = {
  key: 'detailing',
  name: 'Detailing',
  description: '3 acessos por mês',
  monthlyDeltaCents: 25000,
  currency: 'BRL',
  quotaPerCycle: 3,
  quotaUnit: 'access',
  sortOrder: 0,
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ContratarScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    platform.OS = 'android';
    getPremiumPlan.mockReset();
    getPremiumPlan.mockResolvedValue(PLAN);
    startPremiumCheckout.mockReset();
    pollSubscriptionActive.mockReset();
    showToast.mockReset();
    routerReplace.mockClear();
    routerBack.mockClear();
    hookState.modules = {
      modules: [MODULE],
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

  const renderScreen = async (slug: string | undefined = 'fundador') => {
    const { default: ContratarScreen } = await import('../ContratarScreen');
    await act(async () => {
      root.render(<ContratarScreen slug={slug} />);
      await flush();
    });
  };

  const text = () => container.textContent ?? '';

  // 1. Toggling a module changes the rendered total (pins the fresh-`Set`
  // requirement in `toggle`). Fails if `toggle` goes back to mutating the
  // existing Set (`selected.add(key); setSelected(selected)`) — React bails
  // out of re-rendering on an identical object reference, so the new total
  // ("1.250,00") would never appear.
  it('recalculates the rendered total when a module is toggled on', async () => {
    await renderScreen();
    expect(text()).not.toContain('1.250,00');

    const toggle = container.querySelector(
      '[data-testid="contratar-modulo-detailing"]',
    ) as HTMLElement;
    if (!toggle) throw new Error('module toggle not rendered');
    await act(async () => {
      toggle.click();
      await flush();
    });

    expect(text()).toContain('1.250,00');
  });

  // 2. A rapid double tap calls startPremiumCheckout exactly once. Fails if
  // either `if (submitting) return;` is dropped from onSubmit or
  // `disabled={submitting}` is dropped from the CTA — either regression lets
  // a second, overlapping tap through and a second Checkout Session gets
  // created for one member action.
  it('calls startPremiumCheckout exactly once on a rapid double tap', async () => {
    let resolveOutcome: (value: CheckoutOutcome) => void = () => {};
    startPremiumCheckout.mockImplementation(
      () =>
        new Promise<CheckoutOutcome>((resolve) => {
          resolveOutcome = resolve;
        }),
    );
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      cta.click();
      await flush();
    });

    expect(startPremiumCheckout).toHaveBeenCalledTimes(1);

    // Let the pending call resolve so the component settles cleanly.
    await act(async () => {
      resolveOutcome({ kind: 'dismissed' });
      await flush();
    });
  });

  // 3. An `error` outcome shows the generic copy and re-enables the button.
  // Fails if the error branch stops setting errorMsg, or if `finally` stops
  // clearing `submitting` (button would stay disabled forever after a
  // failed attempt).
  it('shows the generic error message and re-enables the CTA on an error outcome', async () => {
    startPremiumCheckout.mockResolvedValue({ kind: 'error', message: 'boom' });
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLButtonElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(text()).toContain(assinaturasCopy.contratar.errorGeneric);
    expect(cta.disabled).toBe(false);
  });

  // 4. A `returned` outcome whose poll resolves true navigates to
  // minha-assinatura and fires the success toast. Fails if the poll-result
  // branches are inverted (member who paid gets stuck, or a not-yet-paid
  // member gets falsely told it worked).
  it('navigates and toasts when returned + poll resolves active', async () => {
    startPremiumCheckout.mockResolvedValue({ kind: 'returned' });
    pollSubscriptionActive.mockResolvedValue(true);
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(pollSubscriptionActive).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(assinaturasCopy.contratar.successToast);
    expect(routerReplace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  // 5. A `returned` outcome whose poll resolves false lands on the pending
  // phase, which must offer a real way forward. Fails on the same branch
  // inversion as (4), or if the pending CTA stops navigating.
  it('renders the pending phase when returned + poll resolves inactive, with a working way forward', async () => {
    startPremiumCheckout.mockResolvedValue({ kind: 'returned' });
    pollSubscriptionActive.mockResolvedValue(false);
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(text()).toContain(assinaturasCopy.contratar.pendingTitle);
    expect(showToast).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();

    const pendingCta = container.querySelector(
      '[data-testid="contratar-pending-cta"]',
    ) as HTMLElement;
    if (!pendingCta) throw new Error('pending CTA not rendered');
    await act(async () => {
      pendingCta.click();
      await flush();
    });

    expect(routerReplace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  // 6. On iOS the CTA never mounts and startPremiumCheckout is never
  // reachable. Fails if `Platform.OS === 'ios'` is typo'd or inverted —
  // Stripe would become reachable from an iOS build.
  it('never renders the CTA and never calls startPremiumCheckout on iOS', async () => {
    platform.OS = 'ios';
    await renderScreen();

    expect(container.querySelector('[data-testid="contratar-cta"]')).toBeNull();
    expect(text()).toContain(assinaturasCopy.contratar.iosTitle);

    expect(startPremiumCheckout).not.toHaveBeenCalled();
  });
});
