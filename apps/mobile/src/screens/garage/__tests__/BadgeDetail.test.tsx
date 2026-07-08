// @vitest-environment jsdom
//
// BadgeDetail tests. Lives here (not packages/ui/src/__tests__/) because
// `@ccc/ui` has no test runner of its own — same precedent as the
// HexBadge / BadgeRow tests added in chunk 17.
//
// react-native + react-native-svg + lucide-react-native are stubbed to
// inert jsdom-friendly tags so the SVG hex polygon and the inline
// `ArrowLeft` icon in the Voltar affordance don't blow up jsdom. The
// lucide mock enumerates every named import that `BadgeGlyph` AND
// `BadgeDetail` consume — vitest validates named imports against the
// mock surface.

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
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
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
      void style;
      void hitSlop;
      void numberOfLines;
      void source;
      void accessible;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ActivityIndicator: make('span'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
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
    Pattern: make('pattern'),
    Rect: make('rect'),
    Line: make('line'),
    G: make('g'),
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
  // Mirror BadgeGlyph.ICON_MAP imports PLUS the ArrowLeft used by the
  // BadgeDetail Voltar affordance.
  return {
    ArrowLeft: make('ArrowLeft'),
    Car: make('Car'),
    CheckSquare: make('CheckSquare'),
    Crown: make('Crown'),
    Flag: make('Flag'),
    Flame: make('Flame'),
    Heart: make('Heart'),
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
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const baseEntry = {
  code: 'CAR-001',
  category: 'carros' as const,
  rarity: 'rare' as const,
  premiumExclusive: false,
  icon: 'car',
};

describe('BadgeDetail', () => {
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

  const renderEl = async (el: React.ReactElement) => {
    await act(async () => {
      root.render(el);
      await flush();
    });
  };

  it('renders the rarity · category pill (canon: badges.jsx line 909)', async () => {
    const { BadgeDetail } = await import('@ccc/ui');
    await renderEl(
      <BadgeDetail
        entry={baseEntry}
        state={{
          code: 'CAR-001',
          state: 'earned',
          earnedAt: '2026-05-01T12:00:00.000Z',
          pinned: false,
          pinnedAt: null,
        }}
      />,
    );
    expect(container.textContent ?? '').toContain('Raro · Carros');
  });

  it('uses every category label (eventos / carros / comunidade / jdm)', async () => {
    const { BadgeDetail } = await import('@ccc/ui');
    const cases: Array<['eventos' | 'carros' | 'comunidade' | 'jdm', string]> = [
      ['eventos', 'Eventos'],
      ['carros', 'Carros'],
      ['comunidade', 'Comunidade'],
      ['jdm', 'CCC'],
    ];
    for (const [cat, label] of cases) {
      await renderEl(
        <BadgeDetail
          entry={{ ...baseEntry, category: cat }}
          state={{ code: baseEntry.code, state: 'locked' }}
        />,
      );
      expect(container.textContent ?? '').toContain(label);
    }
  });

  it('renders the Voltar affordance only when onBack is supplied', async () => {
    const { BadgeDetail } = await import('@ccc/ui');
    await renderEl(<BadgeDetail entry={baseEntry} state={{ code: 'CAR-001', state: 'locked' }} />);
    expect(container.querySelector('i[data-icon="ArrowLeft"]')).toBeNull();
    expect(container.textContent ?? '').not.toContain('Voltar');

    const fn = vi.fn();
    await renderEl(
      <BadgeDetail entry={baseEntry} state={{ code: 'CAR-001', state: 'locked' }} onBack={fn} />,
    );
    const backBtn = container.querySelector(
      'button[aria-label="Voltar para a lista de conquistas"]',
    );
    expect(backBtn).not.toBeNull();
    expect(container.querySelector('i[data-icon="ArrowLeft"]')).not.toBeNull();
    await act(async () => {
      (backBtn as HTMLButtonElement).click();
      await flush();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('marks the pin button aria-disabled when pinCount >= pinCap and not already pinned', async () => {
    const { BadgeDetail } = await import('@ccc/ui');
    const fn = vi.fn();
    await renderEl(
      <BadgeDetail
        entry={baseEntry}
        state={{
          code: 'CAR-001',
          state: 'earned',
          earnedAt: '2026-05-01T12:00:00.000Z',
          pinned: false,
          pinnedAt: null,
        }}
        pinCount={3}
        pinCap={3}
        onTogglePin={fn}
      />,
    );
    const pinBtn = container.querySelector('button[aria-label="Fixar no perfil público"]');
    expect(pinBtn).not.toBeNull();
    expect(pinBtn?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      (pinBtn as HTMLButtonElement).click();
      await flush();
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('pin button fires onTogglePin under the cap', async () => {
    const { BadgeDetail } = await import('@ccc/ui');
    const fn = vi.fn();
    await renderEl(
      <BadgeDetail
        entry={baseEntry}
        state={{
          code: 'CAR-001',
          state: 'earned',
          earnedAt: '2026-05-01T12:00:00.000Z',
          pinned: false,
          pinnedAt: null,
        }}
        pinCount={1}
        pinCap={3}
        onTogglePin={fn}
      />,
    );
    const pinBtn = container.querySelector('button[aria-label="Fixar no perfil público"]');
    expect(pinBtn?.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      (pinBtn as HTMLButtonElement).click();
      await flush();
    });
    expect(fn).toHaveBeenCalledWith('CAR-001');
  });

  it('omits the pin button on locked and locked_premium states', async () => {
    const { BadgeDetail } = await import('@ccc/ui');
    const fn = vi.fn();
    await renderEl(
      <BadgeDetail
        entry={baseEntry}
        state={{ code: 'CAR-001', state: 'locked' }}
        onTogglePin={fn}
      />,
    );
    expect(container.querySelector('button[aria-label="Fixar no perfil público"]')).toBeNull();

    await renderEl(
      <BadgeDetail
        entry={{ ...baseEntry, premiumExclusive: true }}
        state={{ code: 'CAR-001', state: 'locked_premium' }}
        onTogglePin={fn}
      />,
    );
    expect(container.querySelector('button[aria-label="Fixar no perfil público"]')).toBeNull();
    expect(container.textContent ?? '').toContain('Exclusivo Premium');
  });
});
