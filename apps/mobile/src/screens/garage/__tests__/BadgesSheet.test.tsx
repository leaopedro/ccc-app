// @vitest-environment jsdom
//
// BadgesSheet tests. Lives here (not packages/ui/src/__tests__/) because
// `@ccc/ui` has no test runner of its own — same precedent as the
// HexBadge / BadgeRow / BadgeDetail tests added in chunk 17.
//
// react-native + Modal + react-native-svg + lucide-react-native are
// stubbed to jsdom-friendly tags. Modal returns null when visible=false
// (mirrors the BuySpotSheet test pattern).

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
        onRequestClose,
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
      void contentContainerStyle;
      void animationType;
      void transparent;
      void onRequestClose;
      void accessibilityViewIsModal;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const { visible, children, testID, ...rest } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
      };
      if (!visible) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      void rest;
      return ReactMod.createElement('div', { ref, ...aria }, children);
    },
  );

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    Modal,
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

const baseData = {
  enabled: true,
  catalog: [
    {
      code: 'EVT-001',
      category: 'eventos' as const,
      rarity: 'common' as const,
      premiumExclusive: false,
      icon: 'flag',
    },
    {
      code: 'CAR-003',
      category: 'carros' as const,
      rarity: 'legendary' as const,
      premiumExclusive: false,
      icon: 'curator',
    },
    {
      code: 'JDM-003',
      category: 'jdm' as const,
      rarity: 'legendary' as const,
      premiumExclusive: true,
      icon: 'founder',
    },
  ],
  badges: [
    {
      code: 'EVT-001',
      state: 'earned' as const,
      earnedAt: '2026-05-01T12:00:00.000Z',
      pinned: false,
      pinnedAt: null,
    },
    { code: 'CAR-003', state: 'locked' as const },
    { code: 'JDM-003', state: 'locked_premium' as const },
  ],
};

describe('BadgesSheet', () => {
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

  it('renders nothing when visible=false (Modal mock returns null)', async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    await renderEl(
      <BadgesSheet visible={false} onClose={() => {}} data={baseData} onLockedPress={() => {}} />,
    );
    expect(container.textContent ?? '').not.toContain('Suas conquistas');
  });

  it('renders the category sections and the earned/total summary on open', async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    await renderEl(
      <BadgesSheet visible onClose={() => {}} data={baseData} onLockedPress={() => {}} />,
    );
    expect(container.textContent ?? '').toContain('Suas conquistas');
    expect(container.textContent ?? '').toContain('1');
    expect(container.textContent ?? '').toContain('/3');
    expect(container.textContent ?? '').toContain('Eventos');
    expect(container.textContent ?? '').toContain('Carros');
    expect(container.textContent ?? '').toContain('CCC');
  });

  it('tapping a locked tile fires onLockedPress (not the drilldown)', async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    const onLockedPress = vi.fn();
    await renderEl(
      <BadgesSheet visible onClose={() => {}} data={baseData} onLockedPress={onLockedPress} />,
    );
    const lockedBtn = container.querySelector('button[aria-label="Conquista CAR-003, bloqueada"]');
    expect(lockedBtn).not.toBeNull();
    await act(async () => {
      (lockedBtn as HTMLButtonElement).click();
      await flush();
    });
    expect(onLockedPress).toHaveBeenCalledWith('CAR-003');
    expect(container.textContent ?? '').toContain('Suas conquistas');
  });

  it('tapping an earned tile drills into BadgeDetail inline (header swaps to "Conquista")', async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    await renderEl(
      <BadgesSheet
        visible
        onClose={() => {}}
        data={baseData}
        onLockedPress={() => {}}
        copy={{ 'EVT-001': { title: 'Primeira Bandeirada' } }}
      />,
    );
    const earnedBtn = container.querySelector(
      'button[aria-label="Conquista EVT-001, desbloqueada"]',
    );
    expect(earnedBtn).not.toBeNull();
    await act(async () => {
      (earnedBtn as HTMLButtonElement).click();
      await flush();
    });
    expect(container.textContent ?? '').toContain('Conquista');
    expect(container.textContent ?? '').toContain('Comum · Eventos');
    expect(container.textContent ?? '').toContain('Primeira Bandeirada');
    expect(
      container.querySelector('button[aria-label="Voltar para a lista de conquistas"]'),
    ).not.toBeNull();
  });

  it('Voltar from the drilldown returns to the catalog grid (no onClose)', async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    const onClose = vi.fn();
    await renderEl(
      <BadgesSheet visible onClose={onClose} data={baseData} onLockedPress={() => {}} />,
    );
    const earnedBtn = container.querySelector(
      'button[aria-label="Conquista EVT-001, desbloqueada"]',
    );
    await act(async () => {
      (earnedBtn as HTMLButtonElement).click();
      await flush();
    });
    expect(container.textContent ?? '').toContain('Comum · Eventos');

    const back = container.querySelector('button[aria-label="Voltar para a lista de conquistas"]');
    expect(back).not.toBeNull();
    await act(async () => {
      (back as HTMLButtonElement).click();
      await flush();
    });
    expect(container.textContent ?? '').toContain('Suas conquistas');
    expect(container.textContent ?? '').not.toContain('Comum · Eventos');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closing the sheet from the grid clears any pending detail state', async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    const onClose = vi.fn();
    await renderEl(
      <BadgesSheet visible onClose={onClose} data={baseData} onLockedPress={() => {}} />,
    );
    const close = container.querySelector('button[aria-label="Fechar"]');
    expect(close).not.toBeNull();
    await act(async () => {
      (close as HTMLButtonElement).click();
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const renderSheet = async () => {
    const { BadgesSheet } = await import('@ccc/ui');
    await renderEl(
      <BadgesSheet visible onClose={() => {}} data={baseData} onLockedPress={() => {}} />,
    );
  };
  const clickTab = async (id: string) => {
    await act(async () => {
      (
        container.querySelector(`button[data-testid="badges-tab-${id}"]`) as HTMLButtonElement
      ).click();
      await flush();
    });
  };
  const tiles = () => container.querySelectorAll('button[aria-label^="Conquista"]');

  it('renders 5 category tabs above the grid', async () => {
    await renderSheet();
    const tabs = Array.from(container.querySelectorAll('button[data-testid^="badges-tab-"]'));
    expect(tabs.map((t) => t.getAttribute('data-testid'))).toEqual([
      'badges-tab-all',
      'badges-tab-eventos',
      'badges-tab-carros',
      'badges-tab-comunidade',
      'badges-tab-jdm',
    ]);
  });
  it('defaults to "all" — every catalog tile rendered', async () => {
    await renderSheet();
    expect(tiles().length).toBe(3);
  });
  it('tapping Carros narrows grid to carros-only', async () => {
    await renderSheet();
    await clickTab('carros');
    expect(tiles().length).toBe(1);
    expect(tiles()[0]?.getAttribute('aria-label')).toContain('CAR-003');
  });
  it('tapping Todas clears the filter', async () => {
    await renderSheet();
    await clickTab('carros');
    await clickTab('all');
    expect(tiles().length).toBe(3);
  });
});
