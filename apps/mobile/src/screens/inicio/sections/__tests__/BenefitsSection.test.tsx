// @vitest-environment jsdom
//
// BenefitsSection é puramente visual, então além do texto pinamos os gaps do
// handoff via o mesmo mecanismo `data-style` de
// src/screens/inicio/components/__tests__/primitives.test.tsx: o mock de
// `react-native` grava o style resolvido num atributo sintético que os
// testes leem com JSON.parse. `lucide-react-native` já é redirecionado ao
// stub em apps/mobile/vitest.config.ts, então uma chave de ícone
// desconhecida cai no fallback Star do stub em vez de lançar.

import type { HomeBenefit } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { BenefitsSection } from '../BenefitsSection';

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

const EVENTOS_BENEFIT: HomeBenefit = {
  icon: 'calendar',
  title: 'Eventos exclusivos',
  description: 'Encontros fechados.',
  sortOrder: 0,
};
const DAY_USE_BENEFIT: HomeBenefit = {
  icon: 'chave-que-nao-existe',
  title: 'Day Use',
  description: null,
  sortOrder: 1,
};
const BENEFITS: HomeBenefit[] = [EVENTOS_BENEFIT, DAY_USE_BENEFIT];

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

const styleOf = (el: Element | null): Record<string, unknown> =>
  JSON.parse(el?.getAttribute('data-style') ?? '{}') as Record<string, unknown>;

describe('BenefitsSection', () => {
  it('renders the section label and every benefit', () => {
    render(<BenefitsSection benefits={BENEFITS} />);
    expect(container.textContent).toContain(inicioCopy.sections.benefits);
    expect(container.textContent).toContain('Eventos exclusivos');
    expect(container.textContent).toContain('Encontros fechados.');
    expect(container.textContent).toContain('Day Use');
  });

  it('renders an unknown icon key without crashing', () => {
    // Catches: homeIcon() throwing or returning undefined for an unmapped
    // key instead of falling back to Star, which would crash the render.
    render(<BenefitsSection benefits={[DAY_USE_BENEFIT]} />);
    expect(container.textContent).toContain('Day Use');
    // Proves the fallback actually rendered a glyph, not merely that the row
    // survived without one. The lucide-react-native test stub (aliased in
    // vitest.config.ts) renders every icon as a <lucide-icon data-icon="...">
    // custom element. Catches: guarding the icon render so an unmapped key
    // renders no glyph at all (e.g. `{HOME_ICON[key] ? <Icon /> : null}`),
    // which would leave the text assertion above green but drop the icon.
    const icons = container.querySelectorAll('lucide-icon');
    expect(icons.length).toBe(1);
    expect(icons[0]?.getAttribute('data-icon')).toBe('Star');
  });

  it('renders nothing when the list is empty', () => {
    render(<BenefitsSection benefits={[]} />);
    // Catches: removing the `if (benefits.length === 0) return null;` guard,
    // which would render an empty SectionLabel + list wrapper instead of
    // nothing at all.
    expect(container.textContent).toBe('');
    expect(container.querySelector('span')).toBeNull();
    // The two assertions above pass even for a mutation that returns an empty
    // `<View style={styles.wrap} />` (no text, no span, but still a <div>
    // child of container). This is the actual proof of an early `return null`.
    expect(container.firstChild).toBeNull();
  });

  it('pins the handoff gaps between the label and the benefit rows', () => {
    render(<BenefitsSection benefits={BENEFITS} />);
    const outer = container.querySelector('div[data-style]');
    // Catches: changing styles.wrap's gap away from 14.
    expect(styleOf(outer).gap).toBe(14);
    const list = outer?.querySelector('div[data-style]') ?? null;
    // Catches: changing styles.list's gap away from 12.
    expect(styleOf(list).gap).toBe(12);
  });
});
