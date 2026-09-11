// @vitest-environment jsdom
//
// BoasVindasScreen — the post-purchase welcome. Reached only after
// pollSubscriptionActive resolved true, so the membership already exists;
// usePremiumSubscription is mocked here to drive the loaded / failed states
// without a network. The screen must never turn a confirmed payment into an
// error screen, which is what the failure test pins.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';
import { assinaturasCopy } from '~/copy/assinaturas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type HookResult = {
  subscription: MySubscriptionResponse | null;
  loading: boolean;
  error: boolean;
  billingUnavailable: boolean;
  refresh: () => Promise<void>;
};

const replace = vi.fn();
const push = vi.fn();

const hookState = vi.hoisted(() => ({ value: null as unknown }));
const caixaState = vi.hoisted(() => ({ enabled: false }));

vi.mock('~/hooks/usePremiumSubscription', () => ({
  usePremiumSubscription: () => hookState.value,
}));

vi.mock('~/screens/caixa/caixa-enabled', () => ({
  isCaixaBuildEnabled: () => caixaState.enabled,
}));

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace, push },
}));

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { Check: icon, ChevronRight: icon };
});

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        accessibilityLabel,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        contentContainerStyle,
        color,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void accessibilityState;
      void hitSlop;
      void contentContainerStyle;
      void color;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

const copy = assinaturasCopy.boasVindas;

const activeSub: MySubscriptionResponse = {
  active: true,
  tier: 'gold',
  planSlug: 'fundador',
  planName: 'Fundador',
  planDescription: 'Acesso completo aos benefícios Fundador.',
  benefits: ['Estacionamento prioritário em eventos', 'Convites para encontros exclusivos'],
  cadence: 'monthly',
  currentPeriodEnd: '2026-08-22T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  baseAmountCents: 29900,
  addonsAmountCents: 0,
  totalAmountCents: 29900,
  currency: 'BRL',
  addons: [],
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('BoasVindasScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    replace.mockClear();
    push.mockClear();
    caixaState.enabled = false;
    hookState.value = {
      subscription: activeSub,
      loading: false,
      error: false,
      billingUnavailable: false,
      refresh: () => Promise.resolve(),
    } satisfies HookResult;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const render = async () => {
    const { default: BoasVindasScreen } = await import('../BoasVindasScreen');
    await act(async () => {
      root.render(<BoasVindasScreen />);
      await flush();
    });
  };

  const text = () => container.textContent ?? '';

  // The whole point of the screen: greet the member and show the plan they
  // just bought with its real benefits. Fails if the greeting is dropped or
  // if the benefits stop coming from the subscription payload.
  it('greets the member with the purchased plan and its benefits', async () => {
    await render();

    expect(text()).toContain(copy.title);
    expect(text()).toContain(copy.subcopy);
    expect(text()).toContain('Fundador');
    expect(text()).toContain('Estacionamento prioritário em eventos');
    expect(text()).toContain('Convites para encontros exclusivos');
  });

  // While the subscription read is in flight the screen must not render a
  // welcome with an empty plan and no benefits, which is what it would show
  // if the loading flag were ignored.
  it('shows the loading state instead of a hollow welcome while the read is in flight', async () => {
    hookState.value = {
      subscription: null,
      loading: true,
      error: false,
      billingUnavailable: false,
      refresh: () => Promise.resolve(),
    } satisfies HookResult;
    await render();

    expect(text()).toContain(copy.loading);
    expect(text()).not.toContain(copy.title);
  });

  // The caixa step links into /caixa/montar, which is not in every build.
  // Fails if the step stops following the same flag ContratarScreen's caixa
  // block follows — the member would tap into a route that is not there.
  it('hides the caixa step when the caixa module is not in the build', async () => {
    caixaState.enabled = false;
    await render();

    expect(text()).not.toContain(copy.steps.caixaTitle);
    expect(text()).toContain(copy.steps.eventosTitle);
    expect(text()).toContain(copy.steps.garagemTitle);
  });

  it('navigates to the box builder from the caixa step when the module is in the build', async () => {
    caixaState.enabled = true;
    await render();

    const step = container.querySelector('[data-testid="boas-vindas-passo-caixa"]') as HTMLElement;
    if (!step) throw new Error('caixa step not rendered');

    await act(async () => {
      step.click();
      await flush();
    });

    expect(push).toHaveBeenCalledWith('/caixa/montar');
  });

  // `replace`, not `push`: the checkout this screen confirms is already
  // consumed, so leaving it behind in the history stack would let a back
  // gesture land the member on a dead purchase flow.
  it('replaces into minha-assinatura from the main CTA', async () => {
    await render();

    const cta = container.querySelector('[data-testid="boas-vindas-cta"]') as HTMLElement;
    if (!cta) throw new Error('CTA not rendered');

    await act(async () => {
      cta.click();
      await flush();
    });

    expect(replace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
    expect(push).not.toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  // The payment is already confirmed when this screen renders, so a failed
  // benefits read must degrade to a welcome without the benefits block —
  // never to an error state. Fails if the screen starts branching on `error`.
  it('still welcomes the member when the subscription read fails', async () => {
    hookState.value = {
      subscription: null,
      loading: false,
      error: true,
      billingUnavailable: false,
      refresh: () => Promise.resolve(),
    } satisfies HookResult;
    await render();

    expect(text()).toContain(copy.title);
    expect(text()).toContain(copy.steps.eventosTitle);
    expect(text()).not.toContain(copy.benefitsTitle);
    expect(text()).not.toContain(copy.planLabel);
  });
});
