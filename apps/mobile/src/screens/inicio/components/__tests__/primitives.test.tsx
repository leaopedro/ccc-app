// @vitest-environment jsdom
//
// Os primitivos do handoff são puramente visuais, então o que vale pinar é o
// contrato de interação: o rótulo aparece, o toque dispara, e o FeatureCard
// sem onPress não é um alvo de toque.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppHeader } from '../AppHeader';
import { FeatureCard } from '../FeatureCard';
import { GoldPill } from '../GoldPill';
import { QuickActionTile } from '../QuickActionTile';
import { SectionLabel } from '../SectionLabel';
import { StatCard } from '../StatCard';

// RN primitives become plain HTML tags for jsdom, following the pattern in
// src/screens/assinaturas/__tests__/PlanosScreen.test.tsx.
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
      void style;
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
      void colors;
      void start;
      void end;
      void style;
      return ReactMod.createElement('div', { ref, ...rest });
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

describe('SectionLabel', () => {
  it('renders the label text', () => {
    render(<SectionLabel label="BENEFÍCIOS DA ASSINATURA" />);
    expect(container.textContent).toContain('BENEFÍCIOS DA ASSINATURA');
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
    expect(container.querySelector('[data-testid="static-card"]')).not.toBeNull();
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
});

describe('QuickActionTile', () => {
  it('renders the label and fires onPress', () => {
    const onPress = vi.fn();
    render(<QuickActionTile icon="car" label="Garagem" onPress={onPress} testID="tile" />);
    expect(container.textContent).toContain('Garagem');
    click('tile');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('AppHeader', () => {
  it('renders the wordmark and the location', () => {
    render(<AppHeader />);
    expect(container.textContent).toContain('CASA CAR CLUB');
    expect(container.textContent).toContain('CURITIBA');
  });

  it('renders the right slot when provided', () => {
    render(<AppHeader right={<Text>ENTRAR</Text>} />);
    expect(container.textContent).toContain('ENTRAR');
  });
});
