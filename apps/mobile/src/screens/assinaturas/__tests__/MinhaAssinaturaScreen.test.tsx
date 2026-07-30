// @vitest-environment jsdom
//
// MinhaAssinaturaScreen tests. usePremiumSubscription and usePremiumInvoices
// are mocked to drive the active / inactive / billing-unavailable states and
// the history section independently. cancelPremiumSubscription is mocked to
// pin the cancel sheet: the anti-double-tap guard, the refresh-after-success
// contract (the route never writes the DB itself — only the webhook does),
// and the 409 → Apple-wording branch.
//
// `@ccc/ui` is imported for real (SheetShell is the one sanctioned styling
// import from that package) — react-native-svg is mocked because the
// barrel transitively pulls in components that import it.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MySubscriptionResponse, PremiumInvoice } from '@ccc/shared/premium-subscription';
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

type InvoicesResult = {
  invoices: PremiumInvoice[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

const replace = vi.fn();
const push = vi.fn();

const hookState = vi.hoisted(() => ({
  value: null as unknown,
}));

const invoicesState = vi.hoisted(() => ({
  value: null as unknown,
}));

const cancelMock = vi.hoisted(() => ({ fn: vi.fn() }));
const openURLMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('~/hooks/usePremiumSubscription', () => ({
  usePremiumSubscription: () => hookState.value,
}));

vi.mock('~/hooks/usePremiumInvoices', () => ({
  usePremiumInvoices: () => invoicesState.value,
}));

vi.mock('~/api/premium', () => ({
  cancelPremiumSubscription: (...args: unknown[]) => cancelMock.fn(...args),
}));

// Real ApiError class (not vi.fn()) so `err instanceof ApiError` inside the
// screen's catch branch behaves exactly like production.
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
        accessibilityViewIsModal,
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
      void accessibilityViewIsModal;
      void hitSlop;
      void pointerEvents;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const { visible, children, testID } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
      };
      if (!visible) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      return ReactMod.createElement('div', { ref, ...aria }, children);
    },
  );

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    Modal,
    Linking: { openURL: (url: string) => openURLMock.fn(url) },
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
    Pattern: make('pattern'),
    Line: make('line'),
    Rect: make('rect'),
    LinearGradient: make('linearGradient'),
    Stop: make('stop'),
    Polygon: make('polygon'),
    G: make('g'),
  };
});

// `apps/mobile/vitest.config.ts` aliases `lucide-react-native` globally to
// `test-stubs/lucide-react-native.tsx` (a Proxy stub) — but a *local*
// vi.mock, per that stub's own comment, takes precedence over the alias.
// SheetShell (@ccc/ui) pulls in the whole barrel, which transitively imports
// several icons beyond this screen's own ArrowLeft/Check (BadgeGlyph,
// XPTooltip, HexBadge, …). The shared stub's fixed export list is missing
// `Check` and `Heart`, so list every name currently touched — same pattern
// PlanoDetalheScreen.test.tsx already uses for its own ArrowLeft/Check pair.
vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return {
    ArrowLeft: icon,
    Check: icon,
    Car: icon,
    CheckSquare: icon,
    Crown: icon,
    Flag: icon,
    Flame: icon,
    Heart: icon,
    HelpCircle: icon,
    Home: icon,
    Library: icon,
    Lock: icon,
    MapPin: icon,
    Medal: icon,
    MessageCircle: icon,
    MessageSquare: icon,
    ShieldCheck: icon,
    TrendingUp: icon,
  };
});

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace, push },
}));

const copy = assinaturasCopy.minhaAssinatura;

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
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  totalAmountCents: 164000,
  currency: 'BRL',
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      status: 'active',
      quotaUnit: 'access',
      quotaPerCycle: 3,
      currentCycle: {
        cycleStart: '2026-07-22T00:00:00.000Z',
        cycleEnd: '2026-08-22T00:00:00.000Z',
        quotaTotal: 3,
        quotaUsed: 1,
        quotaRemaining: 2,
      },
    },
  ],
};

const inactiveSub: MySubscriptionResponse = {
  active: false,
  tier: null,
  planSlug: null,
  planName: null,
  planDescription: null,
  benefits: [],
  cadence: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  baseAmountCents: 0,
  addonsAmountCents: 0,
  totalAmountCents: 0,
  currency: 'BRL',
  addons: [],
};

const invoice: PremiumInvoice = {
  periodStart: '2026-06-22T00:00:00.000Z',
  periodEnd: '2026-07-22T00:00:00.000Z',
  paidAt: '2026-06-23T00:00:00.000Z',
  grossAmountCents: 164000,
  currency: 'BRL',
  status: 'paid',
  refundedAt: null,
};

const result = (over: Partial<HookResult>): HookResult => ({
  subscription: null,
  loading: false,
  error: false,
  billingUnavailable: false,
  refresh: () => Promise.resolve(),
  ...over,
});

const invoicesResult = (over: Partial<InvoicesResult>): InvoicesResult => ({
  invoices: [],
  loading: false,
  error: false,
  refresh: () => Promise.resolve(),
  ...over,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('MinhaAssinaturaScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    replace.mockClear();
    push.mockClear();
    cancelMock.fn.mockReset();
    openURLMock.fn.mockReset();
    invoicesState.value = invoicesResult({});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async () => {
    const { default: MinhaAssinaturaScreen } = await import('../MinhaAssinaturaScreen');
    await act(async () => {
      root.render(<MinhaAssinaturaScreen />);
      await flush();
    });
  };

  const text = () => container.textContent ?? '';

  it('renders the active subscription with tier, totals and add-on usage', async () => {
    hookState.value = result({ subscription: activeSub });
    await renderScreen();
    expect(text()).toContain('Fundador');
    expect(text()).toContain('Detailing');
    // base + add-ons + total (cents → BRL)
    expect(text()).toContain('1.490,00');
    expect(text()).toContain('150,00');
    expect(text()).toContain('1.640,00');
    // cycle usage
    expect(text()).toContain('1 de 3 acessos usados');
    expect(text()).toContain('2 restantes');
  });

  it('renders the empty state linking back to plans when inactive', async () => {
    hookState.value = result({ subscription: inactiveSub });
    await renderScreen();
    expect(text()).toContain('Você ainda não é assinante.');
    const cta = container.querySelector(
      '[data-testid="assinatura-empty-cta"]',
    ) as HTMLElement | null;
    if (!cta) throw new Error('empty CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(replace).toHaveBeenCalledWith('/assinaturas');
  });

  it('renders an informative state when billing is unavailable (503/flag off)', async () => {
    hookState.value = result({ billingUnavailable: true });
    await renderScreen();
    expect(text()).toContain('Assinaturas em breve.');
  });

  // 1. Benefits render when the subscription carries them. Fails if the
  // `sub.benefits.length > 0` section is dropped or the map key/text changes.
  it('renders the plan benefits when the subscription carries them', async () => {
    hookState.value = result({ subscription: activeSub });
    await renderScreen();
    expect(text()).toContain(copy.benefitsTitle);
    expect(text()).toContain('Estacionamento prioritário em eventos');
    expect(text()).toContain('Convites para encontros exclusivos');
  });

  // 2. The history section renders rows when invoices exist, and the empty
  // copy otherwise. Fails if the empty/non-empty branch is inverted or the
  // row fields (period/paidAt/amount) stop reading from the invoice.
  it('renders history rows when invoices exist', async () => {
    hookState.value = result({ subscription: activeSub });
    invoicesState.value = invoicesResult({ invoices: [invoice] });
    await renderScreen();
    expect(text()).toContain(copy.historico.title);
    expect(text()).toContain('1.640,00');
    expect(text()).not.toContain(copy.historico.empty);
  });

  it('renders the empty history copy when there are no invoices', async () => {
    hookState.value = result({ subscription: activeSub });
    invoicesState.value = invoicesResult({ invoices: [] });
    await renderScreen();
    expect(text()).toContain(copy.historico.title);
    expect(text()).toContain(copy.historico.empty);
  });

  // 3. A failing invoices fetch degrades only that section — the
  // subscription card must still render. Fails if InvoiceHistory's error
  // return value is (or propagates as) a thrown error, or if the parent
  // screen only renders `body` after both hooks agree.
  it('degrades only the history section when the invoices fetch fails', async () => {
    hookState.value = result({ subscription: activeSub });
    invoicesState.value = invoicesResult({ error: true });
    await renderScreen();
    // subscription card still up
    expect(text()).toContain('Fundador');
    expect(text()).toContain('1.640,00');
    // history degraded to its error copy, not the title/empty copy
    expect(text()).toContain(copy.historico.error);
    expect(text()).not.toContain(copy.historico.title);
  });

  // 4. Confirming cancel calls cancelPremiumSubscription exactly once even on
  // a rapid double tap, and calls refresh() afterwards. Fails if the guard is
  // state-based (`cancelling`) instead of ref-based — `setState` does not
  // apply synchronously, so both taps would read the stale `false` and both
  // reach the API call.
  it('calls cancelPremiumSubscription exactly once on a rapid double tap and refreshes after', async () => {
    let resolveCancel: (v: {
      cancelAtPeriodEnd: boolean;
      currentPeriodEnd: string;
    }) => void = () => {};
    cancelMock.fn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const refresh = vi.fn(() => Promise.resolve());
    hookState.value = result({ subscription: activeSub, refresh });
    await renderScreen();

    const trigger = container.querySelector('[data-testid="assinatura-cancelar"]') as HTMLElement;
    if (!trigger) throw new Error('cancel trigger not rendered');
    await act(async () => {
      trigger.click();
      await flush();
    });

    const confirm = container.querySelector(
      '[data-testid="assinatura-cancelar-confirmar"]',
    ) as HTMLElement;
    if (!confirm) throw new Error('cancel confirm not rendered');

    await act(async () => {
      confirm.click();
      confirm.click();
      await flush();
    });

    expect(cancelMock.fn).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      resolveCancel({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-08-22T00:00:00.000Z' });
      await flush();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // 5. A 409 from cancel switches the sheet to the Apple wording instead of a
  // generic error. Fails if the `err.status === 409` branch is dropped or if
  // it sets the generic error message instead of `isApple`.
  it('switches to Apple wording on a 409 NotStripeSubscription response', async () => {
    const { ApiError } = (await import('~/api/client')) as unknown as {
      ApiError: new (status: number, message: string, body?: unknown) => Error;
    };
    cancelMock.fn.mockRejectedValue(
      new ApiError(409, 'not stripe', {
        error: 'NotStripeSubscription',
        provider: 'apple_revenuecat',
        manageUrl: 'https://apps.apple.com/account/subscriptions',
      }),
    );
    hookState.value = result({ subscription: activeSub });
    await renderScreen();

    const trigger = container.querySelector('[data-testid="assinatura-cancelar"]') as HTMLElement;
    await act(async () => {
      trigger.click();
      await flush();
    });

    const confirm = container.querySelector(
      '[data-testid="assinatura-cancelar-confirmar"]',
    ) as HTMLElement;
    await act(async () => {
      confirm.click();
      await flush();
    });

    expect(text()).toContain(copy.cancelar.appleBody);
    expect(text()).not.toContain(copy.cancelar.error);
  });
});
