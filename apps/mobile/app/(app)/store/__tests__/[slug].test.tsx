// @vitest-environment jsdom
//
// StoreProductDetailScreen tests.
//
// Reason this file exists: an anonymous visitor who tapped "Adicionar" got the
// toast "Erro ao adicionar item ao carrinho." and stayed put. `/store/:slug` is
// a public route on purpose, so the page rendered fine; the CTA just called
// `addItem`, and `authedRequest` throws ApiError(401, 'no access token') before
// any fetch. Reproduced against production on 2026-08-27 with `adesivo-01`:
// the toast appeared and zero requests hit /cart.
//
// The load-bearing assertion is `addItem` NOT being called for an anonymous
// member. A test that only checks the redirect would still pass if the screen
// fired the doomed request first.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreProduct } from '@ccc/shared/store';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const addItem = vi.fn<(input: unknown) => Promise<void>>();
const routerPush = vi.fn();
const showMessage = vi.fn();

const state = vi.hoisted(() => ({
  authStatus: 'unauthenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  params: {} as Record<string, string>,
  product: null as StoreProduct | null,
}));

// The screen reaches `~/api/client` through `~/cart/error-message`, and that
// loads expo-constants → expo-modules-core, which references `__DEV__` and
// blows up under jsdom. Same stub the cart and assinaturas tests use.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => state.params,
  useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('~/auth/context', () => ({ useAuth: () => ({ status: state.authStatus }) }));
vi.mock('~/cart/context', () => ({ useCart: () => ({ addItem, adding: false }) }));
vi.mock('~/lib/confirm', () => ({ showMessage: (m: string) => showMessage(m) }));
vi.mock('~/hooks/useStoreProductDetail', () => ({
  useStoreProductDetail: () => ({
    product: state.product,
    collections: [],
    loading: false,
    error: null,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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
        pointerEvents,
        contentContainerStyle,
        source,
        resizeMode,
        visible,
        transparent,
        animationType,
        onRequestClose,
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
      void pointerEvents;
      void contentContainerStyle;
      void source;
      void resizeMode;
      void onRequestClose;
      void animationType;
      void transparent;
      // Modal renders nothing when closed, matching the real component.
      if (tag === 'dialog' && visible === false) return null;
      return ReactMod.createElement(tag === 'dialog' ? 'div' : tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Image: make('img'),
    Modal: make('dialog'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    Platform: { OS: 'web' },
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

vi.mock('@ccc/ui', async () => {
  const ReactMod = await import('react');
  return {
    Text: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { variant, tone, style, ...rest } = props;
      void variant;
      void tone;
      void style;
      return ReactMod.createElement('span', { ...rest, ref });
    }),
    Button: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { label, onPress, disabled, ...rest } = props;
      return ReactMod.createElement(
        'button',
        {
          ...rest,
          ref,
          disabled: Boolean(disabled),
          onClick: onPress as () => void,
          'data-testid': 'add-to-cart',
        },
        label as string,
      );
    }),
  };
});

const variant = (over: Partial<StoreProduct['variants'][number]> = {}) =>
  ({
    id: 'var_1',
    sku: null,
    title: 'Unico',
    priceCents: 499,
    displayPriceCents: 549,
    devFeePercent: 10,
    compareAtPriceCents: null,
    currency: 'BRL',
    stockOnHand: 10,
    isActive: true,
    capacityDisplay: {
      status: 'available',
      mode: 'absolute',
      showAbsolute: true,
      showPercentage: false,
      remaining: 10,
      remainingPercent: 100,
      thresholdPercent: 15,
    },
    ...over,
  }) as StoreProduct['variants'][number];

const soldOut = () =>
  variant({
    id: 'var_sold_out',
    stockOnHand: 0,
    capacityDisplay: {
      status: 'sold_out',
      mode: 'absolute',
      showAbsolute: true,
      showPercentage: false,
      remaining: 0,
      remainingPercent: 0,
      thresholdPercent: 15,
    },
  } as never);

const makeProduct = (variants: StoreProduct['variants']): StoreProduct =>
  ({
    id: 'prod_1',
    slug: 'adesivo-01',
    title: 'Adesivo Casa Redondo',
    description: 'Adesivo redondo',
    shortDescription: null,
    status: 'active',
    canShip: true,
    canPickup: true,
    coverImageUrl: null,
    collectionIds: [],
    productType: { id: 'pt_1', slug: 'adesivos', name: 'Adesivos', description: null },
    variants,
    images: [],
  }) as unknown as StoreProduct;

let container: HTMLDivElement;
let root: Root;

const renderScreen = async () => {
  const { default: Screen } = await import('../[slug]');
  await act(async () => {
    root.render(<Screen />);
  });
};

const tapAdd = async () => {
  const btn = container.querySelector('[data-testid="add-to-cart"]') as HTMLButtonElement | null;
  if (!btn) throw new Error('CTA nao renderizado');
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });
};

describe('StoreProductDetailScreen — anonymous add to cart', () => {
  beforeEach(() => {
    vi.resetModules();
    addItem.mockReset().mockResolvedValue(undefined);
    routerPush.mockReset();
    showMessage.mockReset();
    state.authStatus = 'unauthenticated';
    state.params = { slug: 'adesivo-01' };
    state.product = makeProduct([variant()]);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('routes an anonymous member to login and never calls addItem', async () => {
    await renderScreen();
    await tapAdd();

    // The whole point: no doomed request, and a way forward.
    expect(addItem).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush.mock.calls[0]?.[0]).toBe(
      `/login?next=${encodeURIComponent('/store/adesivo-01?variantId=var_1')}`,
    );
  });

  it('carries the quantity the member picked into the login round trip', async () => {
    // The real scenario: an anonymous visitor bumps the quantity on the page and
    // only then taps Adicionar. Whatever they had chosen has to survive the trip
    // through /login, or they come back to a quantity of 1 and have to redo it.
    await renderScreen();
    const plus = container.querySelector(
      '[aria-label="Aumentar quantidade"]',
    ) as HTMLButtonElement | null;
    if (!plus) throw new Error('botao de aumentar quantidade nao renderizado');
    // One act() per tap on purpose. Both clicks inside a single act() get
    // batched into one render, and updateQuantity reads `quantity` off the
    // render closure, so they would both compute 1 + 1 = 2. Real taps are
    // separate discrete events with a render between them.
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        plus.click();
        await Promise.resolve();
      });
    }

    await tapAdd();

    expect(addItem).not.toHaveBeenCalled();
    expect(routerPush.mock.calls[0]?.[0]).toBe(
      `/login?next=${encodeURIComponent('/store/adesivo-01?variantId=var_1&quantity=3')}`,
    );
  });

  it('does nothing at all while the session is still loading', async () => {
    // A member who IS signed in must not be bounced to /login just because the
    // token had not been read from storage yet.
    state.authStatus = 'loading';
    await renderScreen();
    await tapAdd();

    expect(addItem).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('adds normally once authenticated', async () => {
    state.authStatus = 'authenticated';
    await renderScreen();
    await tapAdd();

    expect(routerPush).toHaveBeenCalledWith('/cart');
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0]?.[0]).toMatchObject({ variantId: 'var_1', quantity: 1 });
  });
});

describe('StoreProductDetailScreen — restoring the selection after login', () => {
  beforeEach(() => {
    vi.resetModules();
    addItem.mockReset().mockResolvedValue(undefined);
    routerPush.mockReset();
    showMessage.mockReset();
    state.authStatus = 'authenticated';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('restores the variant and quantity from the url', async () => {
    state.product = makeProduct([variant({ id: 'var_a' }), variant({ id: 'var_b' })]);
    state.params = { slug: 'adesivo-01', variantId: 'var_b', quantity: '4' };
    await renderScreen();
    await tapAdd();

    expect(addItem.mock.calls[0]?.[0]).toMatchObject({ variantId: 'var_b', quantity: 4 });
  });

  it('clamps a hand-edited quantity to the stock the picker would allow', async () => {
    state.product = makeProduct([variant({ id: 'var_a', stockOnHand: 2 })]);
    state.params = { slug: 'adesivo-01', variantId: 'var_a', quantity: '999' };
    await renderScreen();
    await tapAdd();

    expect(addItem.mock.calls[0]?.[0]).toMatchObject({ variantId: 'var_a', quantity: 2 });
  });

  it('ignores a variantId that is out of stock rather than restoring it', async () => {
    state.product = makeProduct([variant({ id: 'var_a' }), soldOut()]);
    state.params = { slug: 'adesivo-01', variantId: 'var_sold_out', quantity: '2' };
    await renderScreen();
    await tapAdd();

    // Multi-variant with nothing valid selected opens the picker instead.
    expect(addItem).not.toHaveBeenCalled();
  });

  it('ignores a variantId that does not belong to the product', async () => {
    state.product = makeProduct([variant({ id: 'var_a' })]);
    state.params = { slug: 'adesivo-01', variantId: 'var_from_another_product', quantity: '2' };
    await renderScreen();
    await tapAdd();

    // Single-variant products auto-select, so the add still goes through — with
    // the real variant and the default quantity, not the url's.
    expect(addItem.mock.calls[0]?.[0]).toMatchObject({ variantId: 'var_a', quantity: 1 });
  });
});
