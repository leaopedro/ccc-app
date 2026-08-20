// @vitest-environment jsdom
//
// StoreTeaserSection é a exceção deliberada à regra de seção pura (task-9
// brief, D2): consome useStoreProducts e expo-router diretamente porque a
// loja é rota pública, então funciona sem login. Mocamos o hook e o router
// no padrão de apps/mobile/src/screens/assinaturas/__tests__/PlanosScreen.test.tsx,
// e o mesmo mecanismo `data-style` de HeroSection.test.tsx para os valores
// visuais pinados.

import type { StoreProductSummary } from '@ccc/shared/store';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const resolveStyle = (style: unknown): Record<string, unknown> | undefined => {
  const resolved =
    typeof style === 'function' ? (style as (s: unknown) => unknown)({ pressed: false }) : style;
  if (Array.isArray(resolved)) {
    return resolved.reduce<Record<string, unknown>>(
      (acc, entry) => (entry ? { ...acc, ...(entry as Record<string, unknown>) } : acc),
      {},
    );
  }
  return resolved as Record<string, unknown> | undefined;
};

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
        resizeMode,
        source,
        horizontal,
        showsHorizontalScrollIndicator,
        contentContainerStyle,
        accessible,
        numberOfLines,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      const resolvedContentStyle = resolveStyle(contentContainerStyle);
      if (resolvedContentStyle) aria['data-content-style'] = JSON.stringify(resolvedContentStyle);
      void className;
      void hitSlop;
      void pointerEvents;
      void resizeMode;
      void source;
      void horizontal;
      void showsHorizontalScrollIndicator;
      void accessible;
      void numberOfLines;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

const { useStoreProducts, push } = vi.hoisted(() => ({
  useStoreProducts: vi.fn(),
  push: vi.fn(),
}));
vi.mock('~/hooks/useStoreProducts', () => ({ useStoreProducts }));
vi.mock('expo-router', () => ({ router: { push } }));

import { StoreTeaserSection } from '../StoreTeaserSection';

const PRODUCT_1: StoreProductSummary = {
  id: 'prod_1',
  slug: 'camiseta-preta',
  title: 'Camiseta Preta',
  shortDescription: null,
  canShip: true,
  canPickup: false,
  coverImageUrl: 'https://cdn.example.com/camiseta.webp',
  productType: { id: 'pt_1', slug: 'roupas', name: 'Roupas', description: null },
  priceRange: {
    minPriceCents: 8900,
    maxPriceCents: 8900,
    minDisplayPriceCents: 9200,
    maxDisplayPriceCents: 9200,
    devFeePercent: 3,
    currency: 'BRL',
  },
  inStock: true,
};

const PRODUCT_2: StoreProductSummary = {
  ...PRODUCT_1,
  id: 'prod_2',
  slug: 'bone-dourado',
  title: 'Boné Dourado',
  coverImageUrl: null,
};

// Variable-priced product: variants span a range, mirroring what
// apps/mobile/app/(app)/store/index.tsx's formatPriceRange renders as
// "min - max" instead of a single value.
const PRODUCT_VARIABLE: StoreProductSummary = {
  ...PRODUCT_1,
  id: 'prod_3',
  slug: 'jaqueta-casa',
  title: 'Jaqueta Casa',
  priceRange: {
    minPriceCents: 18900,
    maxPriceCents: 24900,
    minDisplayPriceCents: 19500,
    maxDisplayPriceCents: 25700,
    devFeePercent: 3,
    currency: 'BRL',
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  push.mockReset();
  useStoreProducts.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('StoreTeaserSection', () => {
  it('renders the label, the products and their formatted display price', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1, PRODUCT_2],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    expect(container.textContent).toContain(inicioCopy.sections.store);
    expect(container.textContent).toContain('Camiseta Preta');
    expect(container.textContent).toContain('Boné Dourado');
    // Catches: formatting priceRange.minPriceCents (the pre-fee price) instead
    // of minDisplayPriceCents (what the customer actually pays) — the two
    // differ on this fixture on purpose (8900 vs 9200).
    expect(container.textContent).toContain('92');
    expect(container.textContent).not.toContain('89,00');
  });

  it('navigates to the product route with the product slug when a card is pressed', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    click('inicio-store-camiseta-preta');
    expect(push).toHaveBeenCalledWith('/store/camiseta-preta');
  });

  it('navigates to the store index from the footer link', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    click('inicio-store-see-all');
    expect(push).toHaveBeenCalledWith('/store');
  });

  it('renders nothing when the product list is empty', () => {
    useStoreProducts.mockReturnValue({
      items: [],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    expect(container.textContent).toBe('');
    // Catches: returning an empty styled <View> instead of an early `return
    // null;` — the assertion above alone would still pass for that mutation.
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the hook is in an error state, even if items is non-empty', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1],
      nextCursor: null,
      loading: false,
      error: true,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    // Catches: only checking `items.length === 0` and ignoring `error`, which
    // would render stale/inconsistent items alongside a failed refresh.
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
  });

  it('requests a small page via the query passed to useStoreProducts', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    // Catches: dropping the limit and requesting the default (24) page size
    // for a teaser rail that should stay small.
    expect(useStoreProducts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: expect.any(Number) }),
    );
    const [[query]] = useStoreProducts.mock.calls as [[{ limit?: number }]];
    expect(query.limit).toBeLessThanOrEqual(12);
  });

  it('renders a "min - max" range for a variable-priced product instead of a single low price', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_VARIABLE],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    // Node's Intl pt-BR currency formatting inserts U+00A0 (non-breaking
    // space) between "R$" and the digits; normalize to a regular space
    // before asserting so the test doesn't depend on that ICU detail.
    const nbsp = String.fromCharCode(160);
    const normalized = (container.textContent ?? '').split(nbsp).join(' ');
    // Catches: rendering formatBRL(minDisplayPriceCents) alone for a
    // variable-priced product, which would advertise a lower price on the
    // home screen (R$ 195,00) than the store itself shows for the same
    // product (R$ 195,00 - R$ 257,00) — the two surfaces must agree.
    expect(normalized).toContain('R$ 195,00 - R$ 257,00');
  });

  it('does not re-request the store on a re-render (stable query identity)', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    render(<StoreTeaserSection />);
    // useStoreProducts.ts feeds its query argument into
    // `useCallback(refresh, [resolvedQuery])`, whose sole consumer is
    // `useEffect(() => void refresh(), [refresh])`. A fresh object literal
    // built inside StoreTeaserSection's render body would get a new
    // identity every render, re-triggering that effect and firing another
    // GET /store/products indefinitely. Catches: reverting the
    // module-scoped `TEASER_QUERY` back to an inline `{ limit: TEASER_LIMIT }`
    // literal in the component body, which would make this fail because the
    // two calls would receive reference-unequal (structurally equal but
    // distinct) objects.
    expect(useStoreProducts.mock.calls.length).toBeGreaterThanOrEqual(2);
    const [firstCallQuery] = useStoreProducts.mock.calls[0] as [unknown];
    const [secondCallQuery] = useStoreProducts.mock.calls[1] as [unknown];
    expect(firstCallQuery).toBe(secondCallQuery);
  });

  it('pins the card list gap between store teaser cards', () => {
    useStoreProducts.mockReturnValue({
      items: [PRODUCT_1, PRODUCT_2],
      nextCursor: null,
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<StoreTeaserSection />);
    const rail = container.querySelector('div[data-content-style]');
    const contentStyle = JSON.parse(
      rail?.getAttribute('data-content-style') ?? '{}',
    ) as Record<string, unknown>;
    // Catches: changing the horizontal rail's gap away from 12.
    expect(contentStyle.gap).toBe(12);
  });
});
