// @vitest-environment jsdom
//
// AlterarPlanoScreen — the plan-change confirmation screen. The whole point:
// mounting the screen only READS (usePremiumSubscription, getPremiumPlan);
// only the CTA WRITES (changePremiumPlan). Every guard below either proves a
// read-only mount, or proves a refusal renders before any mutation could
// fire.
//
// `~/api/premium` (changePremiumPlan, getPremiumStatus), `~/api/premium-catalog`
// (getPremiumPlan), `~/hooks/usePremiumSubscription`, `~/hooks/usePremiumPlans`
// and `~/screens/assinaturas/poll-subscription` (pollSubscriptionTier) are all
// mocked. `~/screens/assinaturas/plan-change-error` and `~/screens/assinaturas/
// tier-visual` are real — the former needs the real `~/api/client` (ApiError),
// hence the same expo-constants/react-native Platform stub
// plan-change-error.test.ts uses.
//
// The double-tap test is two clicks inside ONE `act`, no flush between them —
// with a flush in between, a `useState`-only guard would also pass and the
// test would prove nothing (MinhaAssinaturaScreen.test.tsx:534-538 same
// pattern).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PremiumPlanDetailResponse } from '@ccc/shared/premium-catalog';
import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';
import type { PremiumStatusResponse } from '~/api/premium';
import { assinaturasCopy } from '~/copy/assinaturas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type SubscriptionHookResult = {
  subscription: MySubscriptionResponse | null;
  loading: boolean;
  error: boolean;
  billingUnavailable: boolean;
  refresh: () => Promise<void>;
};

type PlansHookResult = {
  plans: unknown[];
  loading: boolean;
  error: boolean;
  subscriptionsEnabled: boolean;
  refresh: () => Promise<void>;
};

const replace = vi.fn();
const push = vi.fn();

const hookState = vi.hoisted(() => ({ value: null as unknown }));
const plansState = vi.hoisted(() => ({ value: null as unknown }));

const changePremiumPlan = vi.hoisted(() => ({ fn: vi.fn() }));
const getPremiumStatus = vi.hoisted(() => ({ fn: vi.fn() }));
const getPremiumPlan = vi.hoisted(() => ({ fn: vi.fn() }));
const pollSubscriptionTier = vi.hoisted(() => ({ fn: vi.fn() }));
const showToastMock = vi.hoisted(() => ({ fn: vi.fn() }));
const openURLMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('~/hooks/usePremiumSubscription', () => ({
  usePremiumSubscription: () => hookState.value,
}));

vi.mock('~/hooks/usePremiumPlans', () => ({
  usePremiumPlans: () => plansState.value,
}));

vi.mock('~/api/premium', () => ({
  changePremiumPlan: (input: unknown) => changePremiumPlan.fn(input),
  getPremiumStatus: () => getPremiumStatus.fn(),
}));

vi.mock('~/api/premium-catalog', () => ({
  getPremiumPlan: (slug: string) => getPremiumPlan.fn(slug),
}));

vi.mock('~/screens/assinaturas/poll-subscription', () => ({
  pollSubscriptionTier: (tier: string, cadence: string) => pollSubscriptionTier.fn(tier, cadence),
}));

vi.mock('~/lib/toast', () => ({
  showToast: (message: string) => showToastMock.fn(message),
}));

// `~/screens/assinaturas/plan-change-error` is real (not mocked) — it imports
// the real `~/api/client`, which reads `expo-constants` and `react-native`'s
// `Platform` at module load. Same stub plan-change-error.test.ts uses.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace, push },
}));

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { ArrowLeft: icon, Check: icon, X: icon };
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
        color,
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
      void color;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    Linking: { openURL: (url: string) => openURLMock.fn(url) },
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

const copy = assinaturasCopy.alterar;

const activeSub: MySubscriptionResponse = {
  active: true,
  tier: 'silver',
  planSlug: 'membro',
  planName: 'Membro',
  planDescription: 'Acesso à comunidade Casa Car Club.',
  benefits: ['Acesso a eventos', 'Suporte prioritário'],
  cadence: 'monthly',
  currentPeriodEnd: '2026-08-22T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  status: 'active',
  provider: 'stripe',
  baseAmountCents: 9900,
  addonsAmountCents: 3000,
  totalAmountCents: 12900,
  currency: 'BRL',
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      status: 'active',
      quotaUnit: 'access',
      quotaPerCycle: 3,
      monthlyDeltaCents: 3000,
      currentCycle: null,
    },
  ],
};

// Target plan: gains "Estacionamento prioritário", loses "Suporte
// prioritário" (not in its benefit list) — exercises both diff directions.
const targetPlan: PremiumPlanDetailResponse = {
  tier: 'gold',
  slug: 'estrada',
  name: 'Estrada',
  description: null,
  sortOrder: 1,
  prices: [
    { cadence: 'monthly', baseAmountCents: 14900, currency: 'BRL' },
    { cadence: 'annual', baseAmountCents: 149000, currency: 'BRL' },
  ],
  benefits: [
    { label: 'Acesso a eventos', sortOrder: 0 },
    { label: 'Estacionamento prioritário', sortOrder: 1 },
  ],
  subscriptionsEnabled: true,
};

// Pure upgrade: every current benefit is also in the target's list, so
// `perde` is empty and the loss section must not render.
const upgradePlan: PremiumPlanDetailResponse = {
  ...targetPlan,
  benefits: [
    { label: 'Acesso a eventos', sortOrder: 0 },
    { label: 'Suporte prioritário', sortOrder: 1 },
    { label: 'Estacionamento prioritário', sortOrder: 2 },
  ],
};

const subResult = (over: Partial<SubscriptionHookResult>): SubscriptionHookResult => ({
  subscription: activeSub,
  loading: false,
  error: false,
  billingUnavailable: false,
  refresh: () => Promise.resolve(),
  ...over,
});

const plansResult = (over: Partial<PlansHookResult>): PlansHookResult => ({
  plans: [],
  loading: false,
  error: false,
  subscriptionsEnabled: true,
  refresh: () => Promise.resolve(),
  ...over,
});

const statusResponse = (manageUrl: string | null): PremiumStatusResponse =>
  ({
    active: true,
    tier: 'silver',
    manageUrl,
  }) as PremiumStatusResponse;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('AlterarPlanoScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    replace.mockClear();
    push.mockClear();
    openURLMock.fn.mockReset();
    showToastMock.fn.mockReset();
    changePremiumPlan.fn.mockReset();
    getPremiumStatus.fn.mockReset();
    getPremiumPlan.fn.mockReset();
    pollSubscriptionTier.fn.mockReset();

    hookState.value = subResult({});
    plansState.value = plansResult({});
    getPremiumPlan.fn.mockResolvedValue(targetPlan);
    getPremiumStatus.fn.mockResolvedValue(
      statusResponse('https://billing.stripe.com/session/test_1'),
    );
    changePremiumPlan.fn.mockResolvedValue({ ok: true, pending: true });
    pollSubscriptionTier.fn.mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const render = async (slug: string | undefined = 'estrada') => {
    const { default: AlterarPlanoScreen } = await import('../AlterarPlanoScreen');
    await act(async () => {
      root.render(<AlterarPlanoScreen slug={slug} />);
      await flush();
    });
  };

  const text = () => container.textContent ?? '';
  const cta = () => container.querySelector('[data-testid="alterar-cta"]') as HTMLElement | null;

  it('mostra ganho e perda sem chamar nenhuma mutação', async () => {
    await render();

    expect(text()).toContain(copy.gainTitle);
    expect(text()).toContain('Estacionamento prioritário');
    expect(text()).toContain(copy.loseTitle);
    expect(text()).toContain('Suporte prioritário');

    expect(changePremiumPlan.fn).not.toHaveBeenCalled();
  });

  it('esconde o bloco de perda num upgrade puro', async () => {
    getPremiumPlan.fn.mockResolvedValue(upgradePlan);
    await render();

    expect(text()).not.toContain(copy.loseTitle);
  });

  it('só chama a API no toque do CTA, e navega para Minha Assinatura após o poll confirmar', async () => {
    await render();

    expect(changePremiumPlan.fn).not.toHaveBeenCalled();

    const button = cta();
    if (!button) throw new Error('CTA not rendered');
    await act(async () => {
      button.click();
      await flush();
    });

    expect(changePremiumPlan.fn).toHaveBeenCalledWith({ planSlug: 'estrada', cadence: 'monthly' });
    expect(pollSubscriptionTier.fn).toHaveBeenCalledWith('gold', 'monthly');
    expect(showToastMock.fn).toHaveBeenCalledWith(copy.successToast);
    expect(replace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  it('cai no estado pendente quando o poll estoura', async () => {
    pollSubscriptionTier.fn.mockResolvedValue(false);
    await render();

    const button = cta();
    if (!button) throw new Error('CTA not rendered');
    await act(async () => {
      button.click();
      await flush();
    });

    expect(text()).toContain(copy.pendingTitle);
    expect(replace).not.toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });

  // Anti duplo toque: dois cliques DENTRO de um único `act`, sem flush entre
  // eles — a única forma de exercitar um guard por ref. Com flush no meio, um
  // guard por `useState` também passaria.
  it('chama changePremiumPlan uma única vez mesmo com dois toques rápidos no CTA', async () => {
    let resolveChange: (v: { ok: boolean; pending: boolean }) => void = () => {};
    changePremiumPlan.fn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChange = resolve;
        }),
    );
    await render();

    const button = cta();
    if (!button) throw new Error('CTA not rendered');
    await act(async () => {
      button.click();
      button.click();
      await flush();
    });

    expect(changePremiumPlan.fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChange({ ok: true, pending: true });
      await flush();
    });
  });

  it('membership Apple não chama a API e oferece o link da App Store', async () => {
    hookState.value = subResult({ subscription: { ...activeSub, provider: 'apple_revenuecat' } });
    await render();

    expect(text()).toContain(copy.appleTitle);
    expect(text()).toContain(copy.appleBody);
    expect(cta()).toBeNull();

    const appleCta = container.querySelector('[data-testid="alterar-apple-cta"]') as HTMLElement;
    if (!appleCta) throw new Error('apple CTA not rendered');
    await act(async () => {
      appleCta.click();
      await flush();
    });

    expect(openURLMock.fn).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    expect(changePremiumPlan.fn).not.toHaveBeenCalled();
  });

  it('past_due bloqueia a troca com o link do billing-portal', async () => {
    hookState.value = subResult({ subscription: { ...activeSub, status: 'past_due' } });
    await render();

    expect(text()).toContain(copy.blockedPastDueTitle);
    expect(cta()).toBeNull();

    const portalCta = container.querySelector(
      '[data-testid="alterar-billing-portal-cta"]',
    ) as HTMLElement;
    if (!portalCta) throw new Error('billing portal CTA not rendered');
    await act(async () => {
      portalCta.click();
      await flush();
    });

    expect(getPremiumStatus.fn).toHaveBeenCalled();
    expect(openURLMock.fn).toHaveBeenCalledWith('https://billing.stripe.com/session/test_1');
    expect(changePremiumPlan.fn).not.toHaveBeenCalled();
  });

  it('sai da tela quando o slug já é o plano atual', async () => {
    await render('membro');

    expect(replace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
    expect(changePremiumPlan.fn).not.toHaveBeenCalled();
  });

  // O teste do fator doze: um snapshot anual rotulado de "mensalidade" erraria
  // por 12x. `currentValue`/`newValue` são funções da cadência vigente.
  it('rotula e envia a cadência vigente, sem converter assinante anual', async () => {
    hookState.value = subResult({
      subscription: { ...activeSub, cadence: 'annual', baseAmountCents: 1490000 },
    });
    await render();

    expect(text()).toContain(copy.currentValue('annual'));
    expect(text()).not.toContain(copy.currentValue('monthly'));

    const button = cta();
    if (!button) throw new Error('CTA not rendered');
    await act(async () => {
      button.click();
      await flush();
    });

    expect(changePremiumPlan.fn).toHaveBeenCalledWith({ planSlug: 'estrada', cadence: 'annual' });
    expect(pollSubscriptionTier.fn).toHaveBeenCalledWith('gold', 'annual');
  });
});
