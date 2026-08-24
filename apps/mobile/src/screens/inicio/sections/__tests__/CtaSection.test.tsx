// @vitest-environment jsdom
//
// CtaSection é puramente visual e não decide navegação: só dispara os
// callbacks recebidos. Além do texto e da distinção entre os dois CTAs,
// pinamos o alvo de toque mínimo (44) e o tratamento visual do CTA
// secundário (contornado, fundo transparente, texto dourado) via o mesmo
// mecanismo `data-style` de src/screens/inicio/components/__tests__/primitives.test.tsx
// e src/screens/inicio/sections/__tests__/HeroSection.test.tsx: o mock de
// `react-native` grava o style resolvido num atributo sintético que os
// testes leem com JSON.parse.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';
import { p } from '~/screens/inicio/palette';

import { CtaSection } from '../CtaSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Same flattening rule as primitives.test.tsx's resolveStyle: later entries
// win, falsy entries are skipped.
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
        accessible,
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
      void accessible;
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

describe('CtaSection', () => {
  it('renders both CTAs', () => {
    render(<CtaSection onCreateAccount={vi.fn()} onSubscribe={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.cta.signup);
    expect(container.textContent).toContain(inicioCopy.cta.subscribe);
  });

  it('fires onCreateAccount from the primary CTA', () => {
    const onCreateAccount = vi.fn();
    const onSubscribe = vi.fn();
    render(<CtaSection onCreateAccount={onCreateAccount} onSubscribe={onSubscribe} />);
    click('inicio-cta-signup');
    // Catches: swapping onCreateAccount/onSubscribe wiring on the primary
    // CTA (would call onSubscribe instead, or both).
    expect(onCreateAccount).toHaveBeenCalledTimes(1);
    expect(onSubscribe).not.toHaveBeenCalled();
  });

  it('fires onSubscribe from the secondary CTA', () => {
    const onCreateAccount = vi.fn();
    const onSubscribe = vi.fn();
    render(<CtaSection onCreateAccount={onCreateAccount} onSubscribe={onSubscribe} />);
    click('inicio-cta-subscribe');
    // Catches: swapping onCreateAccount/onSubscribe wiring on the secondary
    // CTA (would call onCreateAccount instead, or both).
    expect(onSubscribe).toHaveBeenCalledTimes(1);
    expect(onCreateAccount).not.toHaveBeenCalled();
  });

  it('pins the secondary CTA minimum touch target and its bordered, transparent, gold-text treatment', () => {
    render(<CtaSection onCreateAccount={vi.fn()} onSubscribe={vi.fn()} />);
    const secondary = container.querySelector('[data-testid="inicio-cta-subscribe"]');
    const style = styleOf(secondary);
    // Catches: shrinking minHeight below 44 on the secondary CTA.
    expect(style.minHeight).toBe(44);
    // Catches: removing the border (or its width) from the secondary CTA,
    // which is what visually distinguishes it from the primary GoldPill.
    expect(style.borderWidth).toBe(1);
    expect(style.borderColor).toBe(p.gold);
    // Catches: giving the secondary CTA a filled background instead of a
    // transparent one, which would make it look like a second primary CTA.
    expect(style.backgroundColor).toBe('transparent');

    const label = secondary?.querySelector('span');
    const labelStyle = styleOf(label ?? null);
    // Catches: changing the secondary label color away from gold (e.g. to
    // match the primary's black-on-gold text), losing the "outlined, gold
    // text" distinction from the filled primary CTA.
    expect(labelStyle.color).toBe(p.gold);
  });
});
