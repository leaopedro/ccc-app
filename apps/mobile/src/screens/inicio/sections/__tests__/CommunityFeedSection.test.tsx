// @vitest-environment jsdom
//
// CommunityFeedSection some por completo com a lista vazia, igual
// ConfirmedCarsSection. O mock de react-native e o de expo-linear-gradient
// vem dos mesmos dois arquivos: o card usa LinearGradient sobre a foto do
// post, entao precisa do segundo mock tambem.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        maxFontSizeMultiplier,
        accessibilityHint,
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
      void maxFontSizeMultiplier;
      void accessibilityHint;
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

vi.mock('expo-linear-gradient', async () => {
  const ReactMod = await import('react');
  return {
    LinearGradient: ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { colors, start, end, style, pointerEvents, ...rest } = props;
      const aria: Record<string, unknown> = {};
      const resolvedStyle = resolveStyle(style);
      if (resolvedStyle) aria['data-style'] = JSON.stringify(resolvedStyle);
      void colors;
      void start;
      void end;
      void pointerEvents;
      return ReactMod.createElement('div', { ref, ...rest, ...aria });
    }),
  };
});

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
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
});

import type { HomeFeedItem } from '@ccc/shared/feed';

import { inicioCopy } from '~/copy/inicio';

import { CommunityFeedSection } from '../CommunityFeedSection';

const post = (overrides: Partial<HomeFeedItem> = {}): HomeFeedItem => ({
  id: 'p1',
  eventId: 'e1',
  car: null,
  body: 'que encontro bom',
  status: 'visible',
  photos: [],
  reactions: { likes: 2, mine: false },
  commentCount: 1,
  isOwn: false,
  createdAt: '2026-09-13T12:00:00.000Z',
  updatedAt: '2026-09-13T12:00:00.000Z',
  event: { slug: 'encontro-setembro', title: 'Encontro de Setembro' },
  ...overrides,
});

describe('CommunityFeedSection', () => {
  it('nao renderiza nada com a lista vazia', async () => {
    await act(async () => {
      root.render(<CommunityFeedSection posts={[]} onOpenEvent={() => {}} />);
    });

    // Catches: perder a guarda posts.length === 0, que deixaria o rotulo
    // "DA COMUNIDADE" sozinho na tela — o caso mais comum, porque o feed so
    // enche quando alguem marca eventos como public.
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
  });

  it('mostra o rotulo, o corpo do post e o titulo do evento', async () => {
    await act(async () => {
      root.render(<CommunityFeedSection posts={[post()]} onOpenEvent={() => {}} />);
    });

    expect(container.textContent).toContain(inicioCopy.sections.communityFeed);
    expect(container.textContent).toContain('que encontro bom');
    expect(container.textContent).toContain('Encontro de Setembro');
  });

  it('abre o evento do post tocado', async () => {
    const opened: string[] = [];

    await act(async () => {
      root.render(<CommunityFeedSection posts={[post()]} onOpenEvent={(s) => opened.push(s)} />);
    });

    await act(async () => {
      container
        .querySelector('[data-testid="inicio-feed-card-p1"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(opened).toEqual(['encontro-setembro']);
  });

  it('inclui o corpo do post no rotulo de acessibilidade', async () => {
    await act(async () => {
      root.render(<CommunityFeedSection posts={[post()]} onOpenEvent={() => {}} />);
    });

    const label = container
      .querySelector('[data-testid="inicio-feed-card-p1"]')
      ?.getAttribute('aria-label');

    // Catches: um label tipo "Post em X". Pressable colapsa os filhos num no
    // so, entao o que nao estiver no label nao existe para leitor de tela.
    expect(label).toContain('que encontro bom');
  });

  it('renderiza a foto e o gradiente quando o post tem foto', async () => {
    await act(async () => {
      root.render(
        <CommunityFeedSection
          posts={[
            post({
              photos: [
                {
                  id: 'ph1',
                  url: 'https://cdn.example.com/post.webp',
                  width: null,
                  height: null,
                  sortOrder: 0,
                },
              ],
            }),
          ]}
          onOpenEvent={() => {}}
        />,
      );
    });

    // Catches: perder o ramo da foto, ou trocar o gradiente de tres paradas
    // por um scrim chapado, que apagaria a foto em vez de realca-la.
    expect(container.querySelector('img')).not.toBeNull();

    // O <LinearGradient style={styles.fill} .../> e o unico <div> cujo
    // data-style resolve para os quatro offsets absolutos do fill (a Image
    // tambem usa styles.fill, mas vira <img>, nao <div>). Mesma convencao de
    // HeroSection.test.tsx (div[data-style]).
    const fillStyle = JSON.stringify({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
    const gradient = Array.from(container.querySelectorAll('div[data-style]')).find(
      (el) => el.getAttribute('data-style') === fillStyle,
    );
    expect(gradient).not.toBeUndefined();
  });
});
