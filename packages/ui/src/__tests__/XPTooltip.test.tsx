// @vitest-environment jsdom
//
// XPTooltip tests. Mirrors the mobile workspace's working pattern for
// `@jdm/ui` components that depend on react-native: vi.mock RN to
// jsdom-friendly host tags + render via `react-dom/client.createRoot`.
//
// Why not `@testing-library/react-native` (plan §"Tech Stack"):
// TL-RN v12 imports the real `react-native/index.js`, whose source uses
// Flow type syntax (`typeof` operator) that vitest's esbuild transform
// cannot parse under jsdom — `SyntaxError: Unexpected token 'typeof'`
// fires at module-load. The mobile workspace works around this with
// explicit `vi.mock('react-native', ...)` blocks (see
// `apps/mobile/src/screens/garage/__tests__/BadgesSheet.test.tsx`) and
// renders via the same `createRoot` driver. Reusing that exact pattern
// here keeps the harness consistent across the monorepo. Documented
// as a deviation in the chunk PR body.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Side-channel for Modal.onRequestClose. The jsdom mock can't survive
// React's unknown-prop stripping when the callback is spread onto a host
// `<div>` — store the latest handler in a module-scoped map keyed by
// the modal's `testID` and read it back in the Android-back test.
const modalRequestClose = new Map<string, () => void>();

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
      void style;
      void hitSlop;
      void numberOfLines;
      void source;
      void accessible;
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
      if (!visible) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') {
        aria['data-testid'] = testID;
        if (typeof onRequestClose === 'function') {
          modalRequestClose.set(testID, onRequestClose);
        }
      }
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
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
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
    Car: make('Car'),
    Crown: make('Crown'),
    Flag: make('Flag'),
    Heart: make('Heart'),
    Medal: make('Medal'),
    MessageSquare: make('MessageSquare'),
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('XP_RULES', () => {
  it('contains exactly 8 entries in the canonical order', async () => {
    const { XP_RULES } = await import('../XPTooltip.js');
    expect(XP_RULES).toHaveLength(8);
    expect(XP_RULES.map((r) => r.key)).toEqual([
      'event_checkin',
      'car_create',
      'post_create',
      'post_like',
      'badge_award_common',
      'badge_award_rare',
      'badge_award_legendary',
      'premium_activation',
    ]);
  });

  it('matches the awarder deltas at outline §437', async () => {
    const { XP_RULES } = await import('../XPTooltip.js');
    const byKey = Object.fromEntries(XP_RULES.map((r) => [r.key, r.delta]));
    expect(byKey).toEqual({
      event_checkin: 10,
      car_create: 5,
      post_create: 2,
      post_like: 1,
      badge_award_common: 25,
      badge_award_rare: 50,
      badge_award_legendary: 100,
      premium_activation: 200,
    });
  });
});

describe('<XPTooltip />', () => {
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

  it('renders all 8 rule labels when visible', async () => {
    const { XP_RULES, XPTooltip } = await import('../XPTooltip.js');
    await renderEl(<XPTooltip visible onClose={() => {}} />);
    const text = container.textContent ?? '';
    for (const rule of XP_RULES) expect(text).toContain(rule.label);
  });

  it('renders all 8 +N XP deltas when visible', async () => {
    const { XP_RULES, XPTooltip } = await import('../XPTooltip.js');
    await renderEl(<XPTooltip visible onClose={() => {}} />);
    const text = container.textContent ?? '';
    for (const rule of XP_RULES) expect(text).toContain(`+${rule.delta} XP`);
  });

  it('renders the locked PT-BR footer disclaimer verbatim', async () => {
    const { XPTooltip } = await import('../XPTooltip.js');
    await renderEl(<XPTooltip visible onClose={() => {}} />);
    expect(container.textContent ?? '').toContain(
      'XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação.',
    );
  });

  it('renders nothing when visible={false}', async () => {
    const { XP_RULES, XPTooltip } = await import('../XPTooltip.js');
    await renderEl(<XPTooltip visible={false} onClose={() => {}} />);
    expect(container.textContent ?? '').not.toContain(XP_RULES[0]!.label);
  });

  it('calls onClose when the backdrop is pressed', async () => {
    const { XPTooltip } = await import('../XPTooltip.js');
    const onClose = vi.fn();
    await renderEl(<XPTooltip visible onClose={onClose} testID="xp-tooltip" />);
    const backdrop = container.querySelector<HTMLElement>('[data-testid="xp-tooltip-backdrop"]');
    expect(backdrop).not.toBeNull();
    await act(async () => {
      backdrop!.click();
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Android back / Modal onRequestClose fires', async () => {
    const { XPTooltip } = await import('../XPTooltip.js');
    const onClose = vi.fn();
    await renderEl(<XPTooltip visible onClose={onClose} testID="xp-tooltip" />);
    const handler = modalRequestClose.get('xp-tooltip');
    expect(typeof handler).toBe('function');
    await act(async () => {
      handler!();
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when a press lands on the card itself', async () => {
    const { XPTooltip } = await import('../XPTooltip.js');
    const onClose = vi.fn();
    await renderEl(<XPTooltip visible onClose={onClose} testID="xp-tooltip" />);
    const card = container.querySelector<HTMLElement>('[data-testid="xp-tooltip-card"]');
    expect(card).not.toBeNull();
    await act(async () => {
      card!.click();
      await flush();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
