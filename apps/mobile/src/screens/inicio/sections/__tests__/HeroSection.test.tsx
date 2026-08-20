// @vitest-environment jsdom
//
// HeroSection é puramente visual, então além do texto pinamos os valores de
// estilo do handoff (altura e raio do bloco de 210px) via o mesmo mecanismo
// `data-style` de src/screens/inicio/components/__tests__/primitives.test.tsx:
// o mock de `react-native`/`expo-linear-gradient` grava o style resolvido num
// atributo sintético que os testes leem com JSON.parse.

import type { HomeHero, HomeInstitutional } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeroSection } from '../HeroSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Same flattening rule as primitives.test.tsx's resolveStyle: later entries
// win, falsy entries are skipped. HeroSection only ever passes a single
// object (no Pressable-style callback form), but reusing the helper keeps
// the mock identical across section test files.
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

const HERO: HomeHero = {
  title: 'DIRIGIR. CONECTAR. PERTENCER.',
  subtitle: 'O clube de carros de Curitiba.',
  bannerUrl: 'https://cdn.example.com/banner.webp',
};

const INSTITUTIONAL: HomeInstitutional = {
  title: 'A Casa',
  body: 'Um clubhouse automotivo privado em Curitiba.',
  imageUrl: 'https://cdn.example.com/casa.webp',
};

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

describe('HeroSection', () => {
  it('renders the mote, the subtitle and the institutional block', () => {
    render(<HeroSection hero={HERO} institutional={INSTITUTIONAL} />);
    expect(container.textContent).toContain('DIRIGIR. CONECTAR. PERTENCER.');
    expect(container.textContent).toContain('O clube de carros de Curitiba.');
    expect(container.textContent).toContain('A Casa');
    expect(container.textContent).toContain('Um clubhouse automotivo privado em Curitiba.');
  });

  it('omits the subtitle line when subtitle is null', () => {
    render(<HeroSection hero={{ ...HERO, subtitle: null }} institutional={INSTITUTIONAL} />);
    expect(container.textContent).toContain('DIRIGIR. CONECTAR. PERTENCER.');
    expect(container.textContent).not.toContain('O clube de carros de Curitiba.');
  });

  it('renders without images when both urls are null', () => {
    render(
      <HeroSection
        hero={{ ...HERO, bannerUrl: null }}
        institutional={{ ...INSTITUTIONAL, imageUrl: null }}
      />,
    );
    expect(container.textContent).toContain('A Casa');
    // Catches: dropping the `hero.bannerUrl ? <Image /> : null` guard (or its
    // institutional counterpart) so an <Image> renders with an empty/undefined uri.
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the banner image when a bannerUrl is present', () => {
    render(
      <HeroSection hero={HERO} institutional={{ ...INSTITUTIONAL, imageUrl: null }} />,
    );
    // Catches: deleting the <Image> element for the hero banner entirely
    // (or changing its guard to always render null), which would make this
    // true-branch silently regress to nothing rendering. The mock discards
    // the `source` prop (RN images have no DOM src), so presence is what we
    // can assert here.
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('renders the institutional image when an imageUrl is present', () => {
    render(
      <HeroSection hero={{ ...HERO, bannerUrl: null }} institutional={INSTITUTIONAL} />,
    );
    // hero.bannerUrl is null here, so the banner branch renders no <img>. Any
    // <img> found below can only come from the institutional branch, which
    // distinguishes this from the banner-presence test above. Catches:
    // deleting the institutional <Image> element (or its guard always
    // resolving to null), which the both-null and banner-only tests do not
    // exercise.
    expect(container.querySelectorAll('img').length).toBe(1);
  });

  it('pins the handoff hero block height and radius', () => {
    render(<HeroSection hero={HERO} institutional={INSTITUTIONAL} />);
    // The hero block is the first <div> with a data-style (styles.wrap has no
    // sizing values worth pinning on its own; styles.hero carries the 210x20).
    const heroBlock = Array.from(container.querySelectorAll('div[data-style]')).find((el) => {
      const style = styleOf(el);
      return style.height === 210;
    });
    expect(heroBlock).toBeDefined();
    // Catches: changing height from 210 or borderRadius from 20 in styles.hero.
    const style = styleOf(heroBlock ?? null);
    expect(style.height).toBe(210);
    expect(style.borderRadius).toBe(20);
  });

  it('pins the outer section gap between hero, subtitle and institutional block', () => {
    render(<HeroSection hero={HERO} institutional={INSTITUTIONAL} />);
    // styles.wrap is the outermost <div>, rendered first.
    const outer = container.querySelector('div[data-style]');
    // Catches: changing styles.wrap's gap away from 22.
    expect(styleOf(outer).gap).toBe(22);
  });

  it('pins pointer-events="none" on the hero scrim so taps pass through to content placed inside it', () => {
    render(<HeroSection hero={HERO} institutional={INSTITUTIONAL} />);
    // The scrim gradient is the LinearGradient with style={StyleSheet.absoluteFill}
    // (data-style resolves to {}); the mock forwards pointerEvents via ...rest
    // since it isn't destructured out, so it lands on the DOM node verbatim.
    const scrim = container.querySelector('[pointer-events="none"]');
    // Catches: removing pointer-events="none" from the scrim LinearGradient,
    // which would let the full-bleed overlay swallow taps on anything placed
    // inside the hero (Tasks 8/9 CTAs).
    expect(scrim).not.toBeNull();
  });
});
