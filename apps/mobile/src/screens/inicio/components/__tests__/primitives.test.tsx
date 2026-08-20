// @vitest-environment jsdom
//
// Os primitivos do handoff são puramente visuais, então o que vale pinar é o
// contrato de interação: o rótulo aparece, o toque dispara, e o FeatureCard
// sem onPress não é um alvo de toque. Também pinamos os valores de estilo do
// handoff que fazem diferença fora do texto (touch target mínimo, tamanhos,
// letter-spacing, cor, raio) via um atributo `data-style` sintético que o
// mock de `react-native`/`expo-linear-gradient` grava com o style resolvido,
// já que o mock normalmente descarta `style` (RN não tem DOM real).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { p } from '~/screens/inicio/palette';

import { AppHeader } from '../AppHeader';
import { FeatureCard } from '../FeatureCard';
import { GoldPill } from '../GoldPill';
import { QuickActionTile } from '../QuickActionTile';
import { SectionLabel } from '../SectionLabel';
import { StatCard } from '../StatCard';

// RN primitives become plain HTML tags for jsdom, following the pattern in
// src/screens/assinaturas/__tests__/PlanosScreen.test.tsx. `resolveStyle`
// additionally handles Pressable's `style={(state) => [...]}` callback form
// (GoldPill, QuickActionTile, FeatureCard's pressable branch all use it),
// flattening the returned array the same way RN's StyleSheet does: later
// entries win, falsy entries are skipped.
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
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      void className;
      void hitSlop;
      void pointerEvents;
      void resizeMode;
      void source;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

vi.mock('expo-linear-gradient', async () => {
  const ReactMod = await import('react');
  return {
    LinearGradient: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { colors, start, end, style, ...rest } = props;
      const aria: Record<string, unknown> = {};
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      void colors;
      void start;
      void end;
      return ReactMod.createElement('div', { ref, ...rest, ...aria });
    }),
  };
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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

const styleOf = (el: Element | null): Record<string, unknown> =>
  JSON.parse(el?.getAttribute('data-style') ?? '{}') as Record<string, unknown>;

describe('SectionLabel', () => {
  it('renders the label text', () => {
    render(<SectionLabel label="BENEFÍCIOS DA ASSINATURA" />);
    expect(container.textContent).toContain('BENEFÍCIOS DA ASSINATURA');
  });

  it('renders with the handoff type spec', () => {
    render(<SectionLabel label="BENEFÍCIOS DA ASSINATURA" />);
    const style = styleOf(container.querySelector('span'));
    expect(style.fontSize).toBe(10);
    expect(style.letterSpacing).toBe(2.8);
    expect(style.color).toBe(p.goldDeep);
    expect(style.textTransform).toBe('uppercase');
  });
});

describe('GoldPill', () => {
  it('renders the label and fires onPress', () => {
    const onPress = vi.fn();
    render(<GoldPill label="QUERO ASSINAR" onPress={onPress} testID="pill" />);
    expect(container.textContent).toContain('QUERO ASSINAR');
    click('pill');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('meets the 44px minimum touch target', () => {
    render(<GoldPill label="QUERO ASSINAR" onPress={vi.fn()} testID="pill" />);
    const gradientEl = container.querySelector('[data-testid="pill"] [data-style]');
    const style = styleOf(gradientEl);
    expect(style.minHeight).toBe(44);
  });
});

describe('FeatureCard', () => {
  it('renders children and fires onPress when pressable', () => {
    const onPress = vi.fn();
    render(
      <FeatureCard onPress={onPress} accessibilityLabel="Day Use" testID="card">
        <Text>Day Use</Text>
      </FeatureCard>,
    );
    expect(container.textContent).toContain('Day Use');
    click('card');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders children without a press target when onPress is omitted', () => {
    render(
      <FeatureCard testID="static-card">
        <Text>Só informativo</Text>
      </FeatureCard>,
    );
    expect(container.textContent).toContain('Só informativo');
    const el = container.querySelector('[data-testid="static-card"]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('DIV');
    expect(el?.getAttribute('role')).toBeNull();
  });

  it('renders the handoff radius and padding', () => {
    render(
      <FeatureCard testID="static-card">
        <Text>Só informativo</Text>
      </FeatureCard>,
    );
    const style = styleOf(container.querySelector('[data-testid="static-card"]'));
    expect(style.borderRadius).toBe(18);
    expect(style.padding).toBe(16);
  });
});

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard icon="users" label="MEMBROS" value={128} />);
    expect(container.textContent).toContain('MEMBROS');
    expect(container.textContent).toContain('128');
  });

  it('renders with an unknown icon key without crashing', () => {
    render(<StatCard icon="chave-que-nao-existe" label="EVENTOS" value={6} />);
    expect(container.textContent).toContain('EVENTOS');
  });

  it('renders the value with the handoff numeral size', () => {
    render(<StatCard icon="users" label="MEMBROS" value={128} />);
    const spans = container.querySelectorAll('span[data-style]');
    const style = styleOf(spans[spans.length - 1] ?? null);
    expect(style.fontSize).toBe(26);
  });
});

describe('QuickActionTile', () => {
  it('renders the label and fires onPress', () => {
    const onPress = vi.fn();
    render(<QuickActionTile icon="car" label="Garagem" onPress={onPress} testID="tile" />);
    expect(container.textContent).toContain('Garagem');
    click('tile');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('meets the 96px minimum touch target', () => {
    render(<QuickActionTile icon="car" label="Garagem" onPress={vi.fn()} testID="tile" />);
    const style = styleOf(container.querySelector('[data-testid="tile"]'));
    expect(style.minHeight).toBe(96);
  });
});

describe('AppHeader', () => {
  it('renders the wordmark and the location', () => {
    render(<AppHeader />);
    expect(container.textContent).toContain('CASA CAR CLUB');
    expect(container.textContent).toContain('CURITIBA');
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('renders the right slot when provided', () => {
    render(<AppHeader right={<Text>ENTRAR</Text>} />);
    expect(container.textContent).toContain('ENTRAR');
  });

  it('renders the monogram at the handoff 40x40 size', () => {
    render(<AppHeader />);
    const style = styleOf(container.querySelector('img'));
    expect(style.width).toBe(40);
    expect(style.height).toBe(40);
  });
});
