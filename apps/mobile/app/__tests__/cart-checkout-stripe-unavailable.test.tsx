// @vitest-environment jsdom
//
// Final review C1 — a production build with no
// EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must not try to drive a PaymentSheet
// that can never mount. Before this branch, iOS fell back to
// `Linking.openURL(checkoutUrl)` and the purchase worked; the PaymentSheet
// seam introduced by this branch regressed that by always requesting
// `flow: 'native'` and always resolving to the sheet, with no key gate.
//
// This is the keyless-build twin of payment-screen-wiring.test.tsx's cart
// case: same screen, same seams, but `expo-constants` reports no
// stripePublishableKey. It proves the call site (not just
// resolveCartPaymentAction's own unit tests) really requests the hosted flow
// and really opens the browser instead of the sheet.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BeginCheckoutResponse } from '@ccc/shared/cart';
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
    availableFulfillmentMethods: [] as never[],
    version: 1,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return { CART: cart };
});

// No stripePublishableKey — the exact production regression from the final
// review (eas.json production has no EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

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

vi.mock('~/lib/confirm', () => ({ showMessage: vi.fn() }));

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { Car: icon, ChevronDown: icon, ChevronRight: icon, Plus: icon, Trash2: icon };
});

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

const openURLMock = vi.fn<(url: string) => Promise<boolean>>();

// Same primitive stubs as payment-screen-wiring.test.tsx, plus a real
// `Linking.openURL` spy — the seam this test exists to prove gets called.
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
        renderItem?: (info: { item: unknown; index: number; section: unknown }) => unknown;
        renderSectionHeader?: (info: { section: unknown }) => unknown;
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
    Linking: { openURL: (url: string) => openURLMock(url) },
    // Native, not web — the platform this regression actually hits.
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
      absoluteFillObject: {},
    },
  };
});

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

const findButtonByText = (container: HTMLElement, text: string): HTMLButtonElement => {
  const match = Array.from(container.querySelectorAll('button')).find(
    (btn) => btn.textContent?.trim() === text,
  );
  if (!match) throw new Error(`no button found with text "${text}"`);
  return match;
};

describe('cart checkout — no publishable key falls back to hosted checkout', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    beginCheckoutMock.mockReset();
    payMock.mockReset();
    openURLMock.mockReset();
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

  it('requests the hosted flow and opens the checkout url, never the sheet', async () => {
    const response: BeginCheckoutResponse = {
      checkoutId: 'checkout_1',
      status: 'pending',
      cart: fixtures.CART,
      orderIds: ['order_1'],
      provider: 'stripe',
      providerRef: 'cs_test_1',
      clientSecret: null,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      brCode: null,
      reservationExpiresAt: null,
    };
    beginCheckoutMock.mockResolvedValue(response);
    openURLMock.mockResolvedValue(true);

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

    // No key -> request the hosted flow, not native. Regressing this back to
    // an unconditional `flow: 'native'` is exactly the production bug.
    expect(beginCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'card', flow: 'hosted' }),
    );

    // The hosted checkout url opens in the system browser, not the sheet.
    expect(openURLMock).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(payMock).not.toHaveBeenCalled();
  });
});
