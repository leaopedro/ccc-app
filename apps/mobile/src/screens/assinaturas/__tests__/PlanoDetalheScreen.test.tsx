// @vitest-environment jsdom
//
// PlanoDetalheScreen tests. getPremiumPlan is mocked; the CTA fires the honest
// contratação stub (showToast) — no purchase is made.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PremiumPlan } from '@jdm/shared/premium-catalog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const showToast = vi.fn();
const getPremiumPlan = vi.fn<(slug: string) => Promise<PremiumPlan>>();

vi.mock('~/api/premium-catalog', () => ({ getPremiumPlan: (slug: string) => getPremiumPlan(slug) }));
vi.mock('~/lib/toast', () => ({ showToast }));

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
    RadialGradient: make('radialgradient'),
    Rect: make('rect'),
    Stop: make('stop'),
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

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace: vi.fn(), push: vi.fn() },
}));

const SAMPLE: PremiumPlan = {
  tier: 'gold',
  slug: 'fundador',
  name: 'Fundador',
  description: 'O plano mais completo.',
  sortOrder: 2,
  prices: [{ cadence: 'monthly', baseAmountCents: 149000, currency: 'BRL' }],
  benefits: [
    { label: 'Concierge dedicado', sortOrder: 1 },
    { label: 'Acesso 24h', sortOrder: 0 },
  ],
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PlanoDetalheScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    showToast.mockClear();
    getPremiumPlan.mockReset();
    getPremiumPlan.mockResolvedValue(SAMPLE);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async (slug: string | undefined = 'fundador') => {
    const { default: PlanoDetalheScreen } = await import('../PlanoDetalheScreen');
    await act(async () => {
      root.render(<PlanoDetalheScreen slug={slug} />);
      await flush();
    });
  };

  it('renders the fetched plan with price and ordered benefits', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('Fundador');
    expect(text).toContain('OURO');
    expect(text).toContain('1.490,00');
    expect(text).toContain('O plano mais completo.');
    expect(text.indexOf('Acesso 24h')).toBeLessThan(text.indexOf('Concierge dedicado'));
  });

  it('fires the contratação stub toast (no purchase) when Assinar is tapped', async () => {
    await renderScreen();
    const cta = container.querySelector('[data-testid="detalhe-assinar"]') as HTMLElement | null;
    if (!cta) throw new Error('CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Contratação em breve.');
  });

  it('shows a not-found state when the plan is missing', async () => {
    getPremiumPlan.mockRejectedValue(new Error('404'));
    await renderScreen();
    expect(container.textContent ?? '').toContain('Não foi possível carregar');
  });
});
