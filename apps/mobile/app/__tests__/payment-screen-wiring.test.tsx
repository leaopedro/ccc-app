// @vitest-environment jsdom
//
// Task 16 "PLUS" — consolidated call-site wiring safety net.
//
// Across the pagamentos-mobile-app plan, several tasks extracted a
// well-tested pure decision function (resolveCartPaymentAction,
// resolveCartSheetOutcomeAction, selectResumeKind,
// resolveResumeSheetOutcomeAction) and left the screen that WIRES that
// function to the real API call and the PaymentSheet seam uncovered. A
// regression that stops passing `flow: 'native'`, swaps a field into the
// checkout body, or simply deletes the `pay()` call would pass every
// existing unit test for those pure functions untouched.
//
// This file renders the two screens that were genuinely missing coverage
// (cart checkout, resume-order) and asserts the mocked PaymentSheet seam
// (`usePaymentSheet().pay`) is invoked with the exact client secret the
// (mocked) API returned. The pure decision functions themselves
// (~/payments/cart-payment-flow, ~/cart/resume-selector,
// ~/cart/resume-sheet-outcome) are NOT mocked here — they run for real, so
// this proves the call site really reaches them and really acts on their
// result, not just that a mock was configured correctly.
//
// ContratarScreen (the third payment surface named in the brief) already
// has this exact assertion in
// src/screens/assinaturas/__tests__/ContratarScreen.test.tsx (test 7:
// `expect(pay).toHaveBeenCalledWith('pi_sub_secret')`), so it is
// deliberately not duplicated here.
//
// All vi.mock(...) calls below are hoisted to the top of this module by
// Vitest, ABOVE every other top-level statement in the file — including
// plain `const` declarations that come after them in source order. A
// factory that closes over such a const throws "X is not defined" the
// first time it runs. Every value a factory needs is therefore built
// inside the single vi.hoisted() block below, which itself runs first,
// and vi.mock is never nested inside a describe()/it() (nesting breaks
// the hoisting transform's scope analysis).

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BeginCheckoutResponse } from '@ccc/shared/cart';
import type { ResumeOrderResponse } from '@ccc/shared/orders';
import type { PaymentSheetOutcome } from '~/payments/payment-sheet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const fixtures = vi.hoisted(() => {
  const now = '2026-08-30T12:00:00.000Z';

  const cartItem = {
    id: 'item_1',
    eventId: 'event_1',
    tierId: 'tier_1',
    variantId: null,
    source: 'purchase' as const,
    kind: 'ticket' as const,
    quantity: 1,
    requiresCar: false,
    tickets: [],
    extras: [],
    product: null,
    amountCents: 5000,
    currency: 'BRL',
    reservationExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const cartTotals = {
    ticketSubtotalCents: 5000,
    extrasSubtotalCents: 0,
    productsSubtotalCents: 0,
    shippingSubtotalCents: 0,
    discountCents: 0,
    baseAmountCents: 5000,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    amountCents: 5000,
    currency: 'BRL',
  };

  const cart = {
    id: 'cart_1',
    userId: 'user_1',
    status: 'open' as const,
    items: [cartItem],
    totals: cartTotals,
    // No product items -> no fulfillment method to choose, keeps the pay
    // button's gate conditions all false so the click reaches handlePay.
    availableFulfillmentMethods: [] as never[],
    version: 1,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const order = {
    id: 'order_1',
    shortId: 'A1B2',
    kind: 'ticket' as const,
    status: 'pending' as const,
    provider: 'stripe' as const,
    amountCents: 5000,
    baseAmountCents: 5000,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    currency: 'BRL',
    quantity: 1,
    shippingCents: 0,
    createdAt: now,
    paidAt: null,
    expiresAt: null,
    containsTickets: true,
    containsStoreItems: false,
    fulfillmentMethod: null,
    fulfillmentStatus: null,
    event: null,
    items: [] as never[],
    pickupTicketId: null,
  };

  return { CART: cart, ORDER: order };
});

// ---------------------------------------------------------------------------
// Seam + platform mocks shared by both screens.
// ---------------------------------------------------------------------------

const payMock = vi.fn<(clientSecret: string) => Promise<PaymentSheetOutcome>>();
vi.mock('~/payments/payment-sheet', () => ({
  usePaymentSheet: () => ({ pay: (clientSecret: string) => payMock(clientSecret) }),
}));

const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
vi.mock('expo-router', async () => {
  const ReactMod = await import('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactMod.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    useLocalSearchParams: () => ({}),
    useRouter: () => ({
      push: routerPushMock,
      replace: routerReplaceMock,
      back: vi.fn(),
      canGoBack: () => true,
    }),
  };
});

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { stripePublishableKey: 'pk_test_wiring' } } },
}));

vi.mock('~/lib/confirm', () => ({ showMessage: vi.fn() }));

// The global `lucide-react-native` alias (vitest.config.ts) only exports a
// fixed icon catalog for named imports; the cart screen's ChevronDown/
// ChevronRight/Trash2 aren't in it. A local vi.mock takes precedence over
// the alias — same precedent as ProfileMenuScreen.test.tsx.
vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { Car: icon, ChevronDown: icon, ChevronRight: icon, Plus: icon, Trash2: icon };
});

// `@ccc/ui` is a barrel — importing `Button` alone still evaluates every
// other export in the barrel (HexBadge, BadgeGlyph, ParkingStallCard...),
// which pulls in `react-native-svg`, which reaches into `react-native`
// subpaths our own `react-native` mock below doesn't cover (Flow syntax in
// the real react-native/index.js then fails to parse under Vite's SSR
// transform). Stub just the one export the cart screen uses, same
// precedent as ProfileMenuScreen.test.tsx.
vi.mock('@ccc/ui', async () => {
  const ReactMod = await import('react');
  return {
    Button: ({
      label,
      onPress,
      disabled,
    }: {
      label: string;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      ReactMod.createElement(
        'button',
        { onClick: onPress, disabled: !!disabled, type: 'button' },
        label,
      ),
  };
});

// react-native primitives shared by both screens. Platform is fixed to
// 'ios' (non-web, native) since both call sites compute web-vs-native
// behavior from Platform.OS and this test only exercises the native
// PaymentSheet path — the web/hosted-checkout path is already covered by
// resolveCartPaymentAction's own unit tests.
vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityHint,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        pointerEvents,
        contentContainerStyle,
        refreshControl,
        refreshing,
        onRefresh,
        visible,
        transparent,
        animationType,
        onRequestClose,
        numberOfLines,
        source,
        stickySectionHeadersEnabled,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void className;
      void accessibilityHint;
      void accessibilityState;
      void hitSlop;
      void pointerEvents;
      void contentContainerStyle;
      void refreshControl;
      void refreshing;
      void onRefresh;
      void visible;
      void transparent;
      void animationType;
      void onRequestClose;
      void numberOfLines;
      void source;
      void stickySectionHeadersEnabled;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const SectionList = ReactMod.forwardRef(
    (
      props: {
        sections?: { key?: string; data: unknown[] }[];
        renderItem?: (info: { item: unknown; index: number; section: unknown }) => ReactNode;
        renderSectionHeader?: (info: { section: unknown }) => ReactNode;
        keyExtractor?: (item: unknown, index: number) => string;
      },
      ref: unknown,
    ) => {
      const { sections, renderItem, renderSectionHeader, keyExtractor } = props;
      return ReactMod.createElement(
        'div',
        { ref },
        (sections ?? []).map((section, si) =>
          ReactMod.createElement(
            'div',
            { key: section.key ?? si },
            renderSectionHeader ? renderSectionHeader({ section }) : null,
            section.data.map((item, idx) =>
              ReactMod.createElement(
                'div',
                { key: keyExtractor ? keyExtractor(item, idx) : idx },
                renderItem ? renderItem({ item, index: idx, section }) : null,
              ),
            ),
          ),
        ),
      );
    },
  );

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    Modal: make('dialog'),
    RefreshControl: make('span'),
    SectionList,
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
      absoluteFillObject: {},
    },
  };
});

// ---------------------------------------------------------------------------
// Cart-screen-only mocks.
// ---------------------------------------------------------------------------

const beginCheckoutMock =
  vi.fn<(input: Record<string, unknown>) => Promise<BeginCheckoutResponse>>();
vi.mock('~/api/cart', () => ({
  beginCheckout: (input: Record<string, unknown>) => beginCheckoutMock(input),
}));
vi.mock('~/api/events', () => ({ getEventById: vi.fn(), getEventCommerceById: vi.fn() }));
vi.mock('~/api/store', () => ({ getStoreSettings: vi.fn() }));
vi.mock('~/api/tickets', () => ({ listMyTickets: vi.fn() }));
vi.mock('~/hooks/useShippingAddresses', () => ({
  useShippingAddresses: () => ({ items: [], loading: false, error: false, refresh: vi.fn() }),
}));
vi.mock('~/cart/web-stripe-redirect', () => ({ redirectToStripeCheckout: vi.fn() }));
vi.mock('~/cart/context', () => ({
  useCart: () => ({
    cart: fixtures.CART,
    loading: false,
    error: null,
    adding: false,
    stockWarnings: [],
    evictedItems: [],
    itemCount: 1,
    refresh: vi.fn(async () => {}),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Resume-order-screen-only mocks.
// ---------------------------------------------------------------------------

const resumeOrderMock = vi.fn<(orderId: string) => Promise<ResumeOrderResponse>>();
const listMyOrdersMock = vi.fn<() => Promise<{ items: (typeof fixtures)['ORDER'][] }>>();
vi.mock('~/api/orders', () => ({
  resumeOrder: (orderId: string) => resumeOrderMock(orderId),
  listMyOrders: () => listMyOrdersMock(),
  cancelMyOrder: vi.fn(),
  getOrder: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

// Finds the Pressable (rendered as <button>) whose visible text matches
// exactly — both screens render several buttons with distinct copy, so an
// exact match is enough without testIDs on every call site.
const findButtonByText = (container: HTMLElement, text: string): HTMLButtonElement => {
  const match = Array.from(container.querySelectorAll('button')).find(
    (btn) => btn.textContent?.trim() === text,
  );
  if (!match) throw new Error(`no button found with text "${text}"`);
  return match;
};

// ---------------------------------------------------------------------------
// Surface 1: cart checkout (app/(app)/cart/index.tsx)
// ---------------------------------------------------------------------------

describe('cart checkout — PaymentSheet wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    beginCheckoutMock.mockReset();
    payMock.mockReset();
    routerReplaceMock.mockClear();
    routerPushMock.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('drives the PaymentSheet with the clientSecret beginCheckout returned, on card + native', async () => {
    const response: BeginCheckoutResponse = {
      checkoutId: 'checkout_1',
      status: 'requires_action',
      cart: fixtures.CART,
      orderIds: ['order_1'],
      provider: 'stripe',
      providerRef: 'pi_cart_ref',
      clientSecret: 'pi_cart_secret',
      checkoutUrl: null,
      brCode: null,
      reservationExpiresAt: null,
    };
    beginCheckoutMock.mockResolvedValue(response);
    payMock.mockResolvedValue({ kind: 'paid' });

    const { default: CartScreen } = await import('../(app)/cart/index');
    await act(async () => {
      root.render(<CartScreen />);
      await flush();
    });

    const payButton = findButtonByText(container, 'Pagar');
    await act(async () => {
      payButton.click();
      await flush();
    });

    // The call-site risk: `flow: 'native'` is spread directly into the
    // beginCheckout body in the screen, not inside any pure/tested function.
    // Drop it (e.g. revert to always 'hosted') and this fails.
    expect(beginCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'card', flow: 'native' }),
    );

    // The seam: the clientSecret the (mocked) API returned must be exactly
    // what reaches pay(). Swap a field, or drop the pay() call, and this
    // fails while every resolveCartPaymentAction unit test stays green.
    expect(payMock).toHaveBeenCalledWith('pi_cart_secret');

    // 'paid' resolves through the real resolveCartSheetOutcomeAction to
    // 'navigate' -> the screen sends the member to their orders, never
    // marking anything paid itself (webhook does that).
    expect(routerReplaceMock).toHaveBeenCalledWith('/profile/orders');
  });
});

// ---------------------------------------------------------------------------
// Surface 2: resume-order (app/(app)/profile/orders.tsx)
// ---------------------------------------------------------------------------

describe('resume-order — PaymentSheet wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    resumeOrderMock.mockReset();
    listMyOrdersMock.mockReset();
    listMyOrdersMock.mockResolvedValue({ items: [fixtures.ORDER] });
    payMock.mockReset();
    routerReplaceMock.mockClear();
    routerPushMock.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('drives the PaymentSheet with the clientSecret resumeOrder returned, for a pending Stripe order', async () => {
    resumeOrderMock.mockResolvedValue({
      method: 'card',
      orderId: 'order_1',
      clientSecret: 'pi_resume_secret',
      amountCents: 5000,
      baseAmountCents: 5000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
    });
    payMock.mockResolvedValue({ kind: 'paid' });

    const { default: ProfileOrdersScreen } = await import('../(app)/profile/orders');
    await act(async () => {
      root.render(<ProfileOrdersScreen />);
      await flush();
    });

    // selectResumeKind (real, unmocked) must have resolved to 'native-stripe'
    // for this button to exist at all — a platform/availability regression
    // that hides it would fail here before the seam is even reached.
    const payButton = findButtonByText(container, 'Pagar');
    await act(async () => {
      payButton.click();
      await flush();
    });

    expect(resumeOrderMock).toHaveBeenCalledWith('order_1');
    // The seam: the clientSecret resumeOrder returned must reach pay()
    // unchanged. Drop the pay() call or splice in the wrong field and this
    // fails while resolveResumeSheetOutcomeAction's own unit tests stay
    // green.
    expect(payMock).toHaveBeenCalledWith('pi_resume_secret');
  });
});
