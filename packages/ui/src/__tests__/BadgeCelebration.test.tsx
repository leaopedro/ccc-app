// @vitest-environment jsdom
//
// BadgeCelebration tests. Mirrors `XPTooltip.test.tsx`: `@testing-library/react-native`
// cannot parse RN's Flow source under vitest's esbuild transform, so we
// `vi.mock('react-native', ...)` down to jsdom-friendly host tags and render
// via `react-dom/client.createRoot`. Also mocks `react-native-svg` +
// `lucide-react-native` because this component renders `HexBadge`, which
// pulls in both (see `BadgeRow.test.tsx` in apps/mobile for the same combo).
//
// Note: the assertion below reads 'VOCE GANHOU 3 CONQUISTAS' without an
// accent. That's intentional — this test defines its own `copy` fixture, and
// the fixture and the assertion just need to agree with each other. Real
// accented PT-BR copy (VOCÊ) ships in a later task with its own test.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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
        accessibilityViewIsModal,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
        contentContainerStyle,
        animationType,
        transparent,
        onRequestClose: _onRequestClose,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      const disabledFlag =
        accessibilityState &&
        typeof accessibilityState === 'object' &&
        (accessibilityState as { disabled?: boolean }).disabled === true;
      if (disabledFlag) aria['aria-disabled'] = 'true';
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      if (accessible === true) aria['data-accessible'] = 'true';
      void style;
      void hitSlop;
      void numberOfLines;
      void source;
      void contentContainerStyle;
      void animationType;
      void transparent;
      void accessibilityViewIsModal;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const { visible, children, testID, onRequestClose, ...rest } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
        onRequestClose?: () => void;
      };
      if (visible === false) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      void onRequestClose;
      void rest;
      return ReactMod.createElement('div', { ref, ...aria }, children);
    },
  );

  class AnimatedValue {
    _value: number;
    constructor(value: number) {
      this._value = value;
    }
    setValue(value: number) {
      this._value = value;
    }
  }

  const startable = () => ({
    start: (cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true }),
  });

  const Animated = {
    Value: AnimatedValue,
    View: make('div'),
    timing: startable,
    spring: startable,
    parallel: startable,
  };

  const BackHandler = {
    addEventListener: () => ({ remove: () => {} }),
  };

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    Modal,
    Animated,
    BackHandler,
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
    Polygon: make('polygon'),
    Path: make('path'),
  };
});

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const make = (label: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { color, size, strokeWidth, ...rest } = props;
      void color;
      void size;
      void strokeWidth;
      return ReactMod.createElement('i', { ref, 'data-icon': label, ...rest });
    });
  return {
    CalendarDays: make('CalendarDays'),
    Camera: make('Camera'),
    Car: make('Car'),
    CheckSquare: make('CheckSquare'),
    Crown: make('Crown'),
    Flag: make('Flag'),
    Flame: make('Flame'),
    HelpCircle: make('HelpCircle'),
    Home: make('Home'),
    Library: make('Library'),
    Lock: make('Lock'),
    MapPin: make('MapPin'),
    Medal: make('Medal'),
    MessageCircle: make('MessageCircle'),
    MessageSquare: make('MessageSquare'),
    ShieldCheck: make('ShieldCheck'),
    TrendingUp: make('TrendingUp'),
    Trophy: make('Trophy'),
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

import type {
  BadgeCelebrationCopy,
  BadgeCelebrationEntry,
} from '../BadgeCelebration.js';

const copy: BadgeCelebrationCopy = {
  titleOne: 'VOCE GANHOU UMA CONQUISTA',
  titleMany: (count) => `VOCE GANHOU ${count} CONQUISTAS`,
  close: 'Fechar',
  more: (count) => `+${count}`,
};

const entry = (code: string, title: string, description: string): BadgeCelebrationEntry => ({
  code,
  title,
  description,
  rarity: 'common',
  icon: 'flag',
});

describe('<BadgeCelebration />', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const render = async (el: React.ReactElement) => {
    await act(async () => {
      root.render(el);
      await flush();
    });
  };

  const click = (el: Element | null) => {
    if (!el) throw new Error('Expected element to click');
    (el as HTMLElement).click();
  };

  it('mostra titulo e descricao quando e uma conquista', async () => {
    const { BadgeCelebration } = await import('../BadgeCelebration.js');
    await render(
      <BadgeCelebration
        entries={[entry('EVT-001', 'Primeira Largada', 'Seu primeiro check-in.')]}
        copy={copy}
        onClose={() => {}}
        reduceMotion
      />,
    );
    expect(container.textContent).toContain('Primeira Largada');
    expect(container.textContent).toContain('Seu primeiro check-in.');
  });

  it('agrega o titulo e lista os nomes quando sao varias', async () => {
    const { BadgeCelebration } = await import('../BadgeCelebration.js');
    await render(
      <BadgeCelebration
        entries={[entry('EVT-001', 'A', 'a'), entry('CAR-001', 'B', 'b'), entry('COM-001', 'C', 'c')]}
        copy={copy}
        onClose={() => {}}
        reduceMotion
      />,
    );
    expect(container.textContent).toContain('VOCE GANHOU 3 CONQUISTAS');
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('C');
  });

  it('corta em 6 hexagonos e indica o resto', async () => {
    const { BadgeCelebration } = await import('../BadgeCelebration.js');
    const many = Array.from({ length: 10 }, (_, i) => entry(`EVT-00${i % 3}`, `T${i}`, 'd'));
    await render(<BadgeCelebration entries={many} copy={copy} onClose={() => {}} reduceMotion />);
    // Sete hexagonos md (52pt) com espacamento nao cabem em 375pt de largura.
    expect(container.querySelectorAll('[data-testid^="celebration-hex-"]').length).toBe(6);
    expect(container.textContent).toContain('+4');
  });

  it('corta a lista de titulos em 6 quando sao mais que o cap', async () => {
    const { BadgeCelebration } = await import('../BadgeCelebration.js');
    const many = Array.from({ length: 10 }, (_, i) => entry(`EVT-00${i % 3}`, `T${i}`, 'd'));
    await render(<BadgeCelebration entries={many} copy={copy} onClose={() => {}} reduceMotion />);
    // A lista de titulos tem que concordar com os hexagonos visiveis: sem o
    // corte, 10 entradas renderizariam 10 linhas de titulo e empurrariam o
    // botao Fechar para fora da tela em telas pequenas, sem scroll para
    // alcanca-lo.
    expect(container.querySelectorAll('[data-testid="celebration-badge-title"]').length).toBe(6);
    expect(container.textContent).toContain('+4');
  });

  it('chama onClose no botao Fechar', async () => {
    const { BadgeCelebration } = await import('../BadgeCelebration.js');
    const onClose = vi.fn();
    await render(
      <BadgeCelebration
        entries={[entry('EVT-001', 'A', 'a')]}
        copy={copy}
        onClose={onClose}
        reduceMotion
      />,
    );
    click(container.querySelector('[data-testid="celebration-close"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
