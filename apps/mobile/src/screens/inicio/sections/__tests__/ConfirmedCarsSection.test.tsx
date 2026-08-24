// @vitest-environment jsdom
//
// ConfirmedCarsSection é a segunda exceção deliberada à regra de seção pura
// (task-9 brief, D3): busca via getConfirmedCars diretamente. Mocamos
// `~/api/events` no padrão dos outros mocks de módulo `~/api/*` deste repo
// (ex.: useBoxCatalog.test.tsx), e usamos o mesmo `flush()` assíncrono de
// useStoreProducts.test.tsx porque o fetch roda dentro de um useEffect.

import type { ConfirmedCarsResponse } from '@ccc/shared/events';
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

const { getConfirmedCars } = vi.hoisted(() => ({ getConfirmedCars: vi.fn() }));
vi.mock('~/api/events', () => ({ getConfirmedCars }));

import { ConfirmedCarsSection } from '../ConfirmedCarsSection';

const RESPONSE: ConfirmedCarsResponse = {
  items: [
    {
      ref: 'car_1',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      photoUrl: 'https://cdn.example.com/corolla.webp',
      isPremiumActive: false,
    },
    {
      ref: 'car_2',
      make: 'Honda',
      model: 'Civic',
      year: 2021,
      photoUrl: null,
      isPremiumActive: true,
    },
  ],
  total: 2,
};

let container: HTMLDivElement;
let root: Root;

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getConfirmedCars.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
});

describe('ConfirmedCarsSection', () => {
  it('renders the label and every confirmed car name once the fetch resolves', async () => {
    getConfirmedCars.mockResolvedValue(RESPONSE);
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug="encontro-de-verao" />);
      await flush();
      await flush();
    });
    expect(getConfirmedCars).toHaveBeenCalledWith('encontro-de-verao');
    expect(container.textContent).toContain(inicioCopy.sections.confirmedCars);
    expect(container.textContent).toContain('Toyota');
    expect(container.textContent).toContain('Corolla');
    expect(container.textContent).toContain('Honda');
    expect(container.textContent).toContain('Civic');
  });

  it('renders nothing when the confirmed cars list resolves empty', async () => {
    getConfirmedCars.mockResolvedValue({ items: [], total: 0 });
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug="encontro-de-verao" />);
      await flush();
      await flush();
    });
    // Catches: dropping the `cars.length === 0` guard, which would render a
    // "QUEM JÁ CONFIRMOU" heading with nothing under it — the most common
    // case per the brief, so this is load-bearing.
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing and never calls the API when eventSlug is null', async () => {
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug={null} />);
      await flush();
      await flush();
    });
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
    // Catches: calling getConfirmedCars unconditionally (e.g. guarding only
    // the render, not the fetch) — a mutation an empty-render check alone
    // would not catch, since the fetch's resolved value is never awaited by
    // this assertion path.
    expect(getConfirmedCars).not.toHaveBeenCalled();
  });

  it('pins the car photo/placeholder as a 56px circle', async () => {
    getConfirmedCars.mockResolvedValue(RESPONSE);
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug="encontro-de-verao" />);
      await flush();
      await flush();
    });
    const photo = container.querySelector('img[data-style]');
    const style = JSON.parse(photo?.getAttribute('data-style') ?? '{}') as Record<string, unknown>;
    // Catches: changing the avatar size away from 56 or dropping the 28
    // borderRadius that makes it a circle instead of a rounded square.
    expect(style.width).toBe(56);
    expect(style.height).toBe(56);
    expect(style.borderRadius).toBe(28);
  });

  it('renders an img for the car with a photoUrl, and no img for the one without', async () => {
    getConfirmedCars.mockResolvedValue(RESPONSE);
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug="encontro-de-verao" />);
      await flush();
      await flush();
    });
    // RESPONSE has one car with photoUrl (Toyota Corolla) and one without
    // (Honda Civic). Catches: deleting the `car.photoUrl ? <Image/> :
    // <View placeholder/>` guard entirely (0 imgs instead of 1), or
    // inverting it (2 imgs instead of 1).
    expect(container.querySelectorAll('img').length).toBe(1);
  });

  it('renders nothing and does not throw when the fetch rejects', async () => {
    getConfirmedCars.mockRejectedValue(new Error('network error'));
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug="encontro-de-verao" />);
      await flush();
      await flush();
    });
    // Catches: deleting the `.catch(() => setCars([]))` handler in the
    // effect, which would leave an unhandled promise rejection on any 4xx/5xx
    // from the confirmed-cars endpoint on the anonymous home — this test
    // would surface that as an unhandled rejection/thrown error instead of a
    // clean empty render.
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
  });

  it('pins the horizontal rail gap between confirmed-car items', async () => {
    getConfirmedCars.mockResolvedValue(RESPONSE);
    await act(async () => {
      root.render(<ConfirmedCarsSection eventSlug="encontro-de-verao" />);
      await flush();
      await flush();
    });
    const rail = container.querySelector('div[data-content-style]');
    const contentStyle = JSON.parse(rail?.getAttribute('data-content-style') ?? '{}') as Record<
      string,
      unknown
    >;
    // Catches: changing the horizontal rail's gap away from 12.
    expect(contentStyle.gap).toBe(12);
  });
});
