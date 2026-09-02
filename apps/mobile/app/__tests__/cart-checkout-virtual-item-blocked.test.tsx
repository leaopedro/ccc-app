// @vitest-environment jsdom
//
// Final review I3 — a virtual (digital) garage-spot item that reaches
// checkout on iOS is refused by routes/cart.ts with 403
// VIRTUAL_ITEM_IOS_BLOCKED (App Store 3.1.3(e): digital unlock can't sell
// outside IAP). Before this fix the cart screen caught every checkout
// failure the same way — a generic "Erro ao iniciar o pagamento." — leaving
// the member with no idea why, and the item stuck in the cart blocking every
// future checkout. The buy tile itself is hidden on iOS (garage-slots.ts),
// so this only fires for a cart that already held the item.

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BeginCheckoutResponse } from '@ccc/shared/cart';
import { cartCopy } from '~/copy/cart';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const fixtures = vi.hoisted(() => {
  const now = '2026-08-30T12:00:00.000Z';

  // Not a real virtual-item cart (the buy tile that adds one is hidden on
  // iOS — garage-slots.ts). Any cart works here: beginCheckout is mocked to
  // reject regardless of contents, since this test is about the catch-block
  // routing on the error CODE, not about reproducing the garage flow.
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

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { stripePublishableKey: 'pk_test_wiring' } } },
}));

vi.mock('~/payments/payment-sheet', () => ({
  usePaymentSheet: () => ({ pay: vi.fn() }),
}));

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
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
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

const alertMock = vi.fn();

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
    Alert: { alert: (message: string) => alertMock(message) },
    Linking: { openURL: vi.fn() },
    // Native — the platform routes/cart.ts refuses virtual items on.
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

describe('cart checkout — VIRTUAL_ITEM_IOS_BLOCKED', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    beginCheckoutMock.mockReset();
    alertMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('tells the member why, instead of the generic checkout error', async () => {
    const { ApiError } = await import('~/api/client');
    beginCheckoutMock.mockRejectedValue(
      new ApiError(403, 'request failed', {
        error: 'PlatformNotSupported',
        code: 'VIRTUAL_ITEM_IOS_BLOCKED',
        message: 'Itens digitais nao podem ser comprados pelo aplicativo iOS.',
        variantIds: ['variant_virtual_spot'],
      }),
    );

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

    expect(alertMock).toHaveBeenCalledWith(cartCopy.errors.virtualItemIosBlocked);
    expect(alertMock).not.toHaveBeenCalledWith(cartCopy.errors.checkout);
  });
});
