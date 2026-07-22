// @vitest-environment jsdom
//
// PlanosScreen smoke tests. Mirrors the react-native stub pattern used across
// the garage screen tests: RN primitives become plain HTML tags so jsdom can
// render them; svg / gradient / icon / router / toast deps are mocked.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const showToast = vi.fn();

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
  return { ArrowLeft: icon, Check: icon, SprayCan: icon, Wrench: icon };
});

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace: vi.fn() },
}));

vi.mock('~/lib/toast', () => ({ showToast }));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PlanosScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    showToast.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async () => {
    const { default: PlanosScreen } = await import('../PlanosScreen');
    await act(async () => {
      root.render(<PlanosScreen />);
      await flush();
    });
  };

  it('renders the three plan tiers with names and prices', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('BRONZE');
    expect(text).toContain('PRATA');
    expect(text).toContain('OURO');
    expect(text).toContain('Ingresso');
    expect(text).toContain('Estrada');
    expect(text).toContain('Fundador');
    expect(text).toContain('R$490');
    expect(text).toContain('R$890');
    expect(text).toContain('R$1.490');
  });

  it('marks the Ouro tier as recommended and renders the CTAs', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('RECOMENDADO');
    expect(text).toContain('ASSINAR BRONZE');
    expect(text).toContain('ASSINAR PRATA');
    expect(text).toContain('ASSINAR OURO');
  });

  it('renders the optional add-on modules', async () => {
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('MÓDULOS ADICIONAIS');
    expect(text).toContain('Detailing');
    expect(text).toContain('+R$150');
    expect(text).toContain('Oficina');
    expect(text).toContain('+R$500');
  });

  it('fires the placeholder checkout toast when a plan is tapped', async () => {
    await renderScreen();
    const cta = container.querySelector('[data-testid="assinar-ouro"]') as HTMLElement | null;
    if (!cta) throw new Error('Ouro CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
