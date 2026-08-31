// @vitest-environment jsdom
//
// ContratarScreen tests. This screen is the highest-risk surface in the
// assinaturas module: it owns package-total math driven by mutable Set
// state, the anti-double-submit guard around a real payment call, and the
// branching over all four startPremiumCheckout outcomes plus the iOS seam.
// Everything a real member's money depends on is pinned here rather than
// left to hand-tracing.
//
// getPremiumPlan, usePremiumAddonModules, startPremiumCheckout,
// pollSubscriptionActive and showToast are all mocked — pollSubscriptionActive
// especially, since the real one sleeps 2s per attempt (up to 15 attempts).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PremiumAddonModule,
  PremiumPlan,
  PremiumPlanDetailResponse,
} from '@ccc/shared/premium-catalog';
import type { PaymentSheetOutcome } from '~/payments/payment-sheet';
import type { CheckoutOutcome } from '~/screens/assinaturas/checkout';
import { assinaturasCopy } from '~/copy/assinaturas';
import { paymentsCopy } from '~/copy/payments';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getPremiumPlan = vi.fn<(slug: string) => Promise<PremiumPlanDetailResponse>>();
const startPremiumCheckout = vi.fn<(input: unknown) => Promise<CheckoutOutcome>>();
const pollSubscriptionActive = vi.fn<() => Promise<boolean>>();
const pay = vi.fn<(clientSecret: string) => Promise<PaymentSheetOutcome>>();
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

vi.mock('~/payments/payment-sheet', () => ({
  usePaymentSheet: () => ({ pay: (clientSecret: string) => pay(clientSecret) }),
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
  return { ArrowLeft: icon, Check: icon };
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
    // Flattened, not nested under `plan` (final review, Important 2) — the
    // real route now returns the plan fields at the top level.
    getPremiumPlan.mockResolvedValue({ ...PLAN, subscriptionsEnabled: true });
    startPremiumCheckout.mockReset();
    pollSubscriptionActive.mockReset();
    pay.mockReset();
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

    // Let the pending call resolve so the component settles cleanly. Any
    // outcome that doesn't trigger further async work (poll-subscription)
    // does; 'error' is the simplest such settle.
    await act(async () => {
      resolveOutcome({
        kind: 'error',
        error: { reason: 'generic', message: assinaturasCopy.contratar.errorGeneric },
      });
      await flush();
    });
  });

  // 3. An `error` outcome shows the resolved copy and re-enables the button.
  // Fails if the error branch stops rendering the message, or if `finally`
  // stops clearing `submitting` (button would stay disabled forever after a
  // failed attempt).
  it('shows the generic error message and re-enables the CTA on an error outcome', async () => {
    startPremiumCheckout.mockResolvedValue({
      kind: 'error',
      error: { reason: 'generic', message: assinaturasCopy.contratar.errorGeneric },
    });
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

  // 3b. The screen must render whatever message the mapper resolved, not a
  // hardcoded generic string. Goes RED if the error branch is reverted to
  // `setErrorMsg(copy.errorGeneric)`, which is what made a 409 with a usable
  // manage link read as "try again".
  it('renders the resolved message and the manage link for AlreadySubscribed', async () => {
    startPremiumCheckout.mockResolvedValue({
      kind: 'error',
      error: {
        reason: 'already_subscribed',
        message: assinaturasCopy.contratar.errorAlreadySubscribed,
        manageUrl: 'https://billing.stripe.com/session/abc',
      },
    });
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLButtonElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(text()).toContain(assinaturasCopy.contratar.errorAlreadySubscribed);
    expect(text()).not.toContain(assinaturasCopy.contratar.errorGeneric);
    expect(text()).toContain(assinaturasCopy.contratar.errorAlreadySubscribedCta);
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

  // 6. iOS now subscribes natively like every other platform: the CTA
  // mounts and tapping it reaches startPremiumCheckout. Fails if the iOS
  // web-contract notice (pre-2026-08-29) comes back and hides the CTA again.
  // That notice was in-app steering to an external purchase method on the
  // Brazil storefront, which the App Store 3.1.3 chapeau forbids outright —
  // so its strings must not render either.
  it('renders the CTA on iOS like every other platform', async () => {
    platform.OS = 'ios';
    startPremiumCheckout.mockResolvedValue({ kind: 'sheet', clientSecret: 'pi_x' });
    pay.mockResolvedValue({ kind: 'paid' });
    pollSubscriptionActive.mockResolvedValue(true);
    await renderScreen();

    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered on iOS');
    expect(text()).not.toContain('pelo site');
    expect(text()).not.toContain('No iPhone');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(startPremiumCheckout).toHaveBeenCalledTimes(1);
  });

  // 7. A `sheet` outcome drives the PaymentSheet via `pay`. When it resolves
  // 'paid', the screen polls before navigating — same rule as the hosted
  // 'returned' path — instead of granting entitlement off the sheet result
  // alone.
  it('drives the PaymentSheet on a sheet outcome and polls before navigating on paid', async () => {
    startPremiumCheckout.mockResolvedValue({ kind: 'sheet', clientSecret: 'pi_sub_secret' });
    pay.mockResolvedValue({ kind: 'paid' });
    pollSubscriptionActive.mockResolvedValue(true);
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(pay).toHaveBeenCalledWith('pi_sub_secret');
    expect(pollSubscriptionActive).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(assinaturasCopy.contratar.successToast);
    expect(routerReplace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  // 8. Cancel is not an error: a closed sheet shows the neutral copy via
  // showToast, never the red inline error banner. Fails if 'cancelled' is
  // routed through setCheckoutError.
  it('shows a neutral toast, not an error, when the sheet is cancelled', async () => {
    startPremiumCheckout.mockResolvedValue({ kind: 'sheet', clientSecret: 'pi_sub_secret' });
    pay.mockResolvedValue({ kind: 'cancelled' });
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(showToast).toHaveBeenCalledWith(paymentsCopy.sheet.cancelled);
    expect(text()).not.toContain(paymentsCopy.sheet.cancelled);
    expect(pollSubscriptionActive).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  // 9. A failed sheet IS an error: shown inline, unlike cancelled.
  it('shows the inline error message when the sheet fails', async () => {
    startPremiumCheckout.mockResolvedValue({ kind: 'sheet', clientSecret: 'pi_sub_secret' });
    pay.mockResolvedValue({ kind: 'failed', code: 'card_declined' });
    await renderScreen();
    const cta = container.querySelector('[data-testid="contratar-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(text()).toContain(paymentsCopy.sheet.failed);
    expect(pollSubscriptionActive).not.toHaveBeenCalled();
  });

  // 10. The last screen before payment must show what the money buys.
  // Decision 6: the physical box has to be visible BEFORE the purchase, and
  // the box lives in these DB-backed benefit labels, not in any copy file.
  it('renders the plan benefits, in sortOrder', async () => {
    getPremiumPlan.mockResolvedValue({
      ...PLAN,
      benefits: [
        { label: 'Caixa física trimestral na sua casa', sortOrder: 2 },
        { label: 'Acesso ao clube 24 horas', sortOrder: 1 },
      ],
      subscriptionsEnabled: true,
    });
    await renderScreen();

    const body = text();
    expect(body).toContain('Acesso ao clube 24 horas');
    expect(body).toContain('Caixa física trimestral na sua casa');
    expect(body.indexOf('Acesso ao clube 24 horas')).toBeLessThan(
      body.indexOf('Caixa física trimestral na sua casa'),
    );
  });

  // 10b. `PLAN` ships `benefits: []` — today's real production data. Nothing
  // benefit-related may render: no heading, no empty box.
  it('renders nothing benefit-related when the plan has no benefits', async () => {
    await renderScreen();
    expect(text()).not.toContain(assinaturasCopy.detail.benefitsTitle);
  });

  // 11. Decision 6: the physical box has to be visible BEFORE the purchase,
  // framed as a physical good delivered to an address. Guideline 3.1.3(e)
  // turns on the word "physical", and a reviewer only sees what the paywall
  // renders.
  it('states the physical box and its delivery cadence before purchase', async () => {
    await renderScreen();
    const body = text();
    expect(body).toContain(assinaturasCopy.caixa.title);
    expect(body).toContain(assinaturasCopy.caixa.delivery);
  });
});
