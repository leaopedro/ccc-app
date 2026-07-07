// @vitest-environment jsdom
//
// ProfileStats tests. Mirrors `XPTooltip.test.tsx` exactly: vi.mock
// `react-native` to jsdom-friendly host tags + render via
// `react-dom/client.createRoot`. The package has no
// `@testing-library/react-native` dep (Canon §15.5 / §15.6 — no new
// deps), so we reuse the same harness chunk 38 established. Documented
// as a deviation in the chunk PR body.

import type { GarageProgress, GarageStats } from '@jdm/shared/garage-progress';
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
        accessibilityElementsHidden,
        importantForAccessibility,
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
      void accessibilityElementsHidden;
      void importantForAccessibility;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const {
        visible,
        children,
        testID,
        onRequestClose: _onRequestClose,
        ...rest
      } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
        onRequestClose?: () => void;
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
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

// XPScoreboard imports react-native-svg (Svg/Defs/Rect/LinearGradient/Stop).
// Mirror apps/mobile/src/screens/garage/__tests__/XPScoreboard.test.tsx —
// stub to inert host tags so esbuild never parses the real Flow source.
vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { style, ...rest } = props;
      void style;
      return ReactMod.createElement(tag, { ref, ...rest });
    });
  return {
    default: make('svg'),
    Svg: make('svg'),
    Defs: make('defs'),
    Rect: make('rect'),
    LinearGradient: make('lineargradient'),
    Stop: make('stop'),
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const zeroProgress: GarageProgress = {
  xp: 0,
  rank: 'Iniciante',
  nextRank: 'Pilotador',
  xpInTier: 0,
  xpToNextRank: 100,
  tierSpan: 100,
};
const zeroStats: GarageStats = {
  events: 0,
  posts: 0,
  likesReceived: 0,
  joinedAt: '2026-02-01T00:00:00.000Z',
};
const activeProgress: GarageProgress = {
  ...zeroProgress,
  xp: 42,
  xpInTier: 42,
  xpToNextRank: 58,
};
const activeStats: GarageStats = { ...zeroStats, events: 3, posts: 2, likesReceived: 5 };

describe('ProfileStats', () => {
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

  const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  describe('short-circuits', () => {
    it('renders nothing when gamificationEnabled is false (owner with full data)', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={activeProgress}
          stats={activeStats}
          gamificationEnabled={false}
          viewMode="owner"
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    it('renders nothing when gamificationEnabled is false (public with full data)', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={activeProgress}
          stats={activeStats}
          gamificationEnabled={false}
          viewMode="public"
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    it('public view with all-zero metrics returns null (hide-on-empty)', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={zeroProgress}
          stats={zeroStats}
          gamificationEnabled={true}
          viewMode="public"
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    it('public view with progress + stats omitted (server short-circuit) returns null', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats gamificationEnabled={true} viewMode="public" testID="profile-stats" />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    it('owner view with isFreshSignup=true returns null', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={zeroProgress}
          stats={zeroStats}
          gamificationEnabled={true}
          viewMode="owner"
          isFreshSignup={true}
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    // §C10 missing-payload contract — both fields are `.optional()` on the wire.
    // Past the killswitch + freshness + all-zero gates, any missing block forces
    // null render (defence-in-depth; the server should not have sent half a block).
    it('owner view returns null when progress is undefined', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          stats={activeStats}
          gamificationEnabled={true}
          viewMode="owner"
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    it('owner view returns null when stats is undefined', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={activeProgress}
          gamificationEnabled={true}
          viewMode="owner"
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).toBeNull();
    });

    it('owner view returns null when both progress and stats are undefined', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats gamificationEnabled={true} viewMode="owner" testID="profile-stats" />,
      );
      expect(q('profile-stats')).toBeNull();
    });
  });

  describe('renders', () => {
    it('owner view, non-fresh, all-zero metrics still renders the scoreboard', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={zeroProgress}
          stats={zeroStats}
          gamificationEnabled={true}
          viewMode="owner"
          isFreshSignup={false}
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats')).not.toBeNull();
      expect(q('profile-stats-scoreboard')).not.toBeNull();
      expect(q('profile-stats-row')).not.toBeNull();
    });

    it('public view with any metric > 0 renders scoreboard + stats row', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={activeProgress}
          stats={activeStats}
          gamificationEnabled={true}
          viewMode="public"
          testID="profile-stats"
        />,
      );
      expect(q('profile-stats-scoreboard')).not.toBeNull();
      expect(q('profile-stats-row')).not.toBeNull();
      // Tooltip Modal is invisible by default — under the RN Modal mock,
      // an invisible Modal renders null, so the tooltip node is absent.
      expect(q('profile-stats-tooltip')).toBeNull();
    });
  });

  describe('tooltip open/close state', () => {
    it('tapping the scoreboard hint button opens the tooltip', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={activeProgress}
          stats={activeStats}
          gamificationEnabled={true}
          viewMode="owner"
          testID="profile-stats"
        />,
      );

      // Closed state — Modal mock returns null when visible=false.
      expect(q('profile-stats-tooltip')).toBeNull();

      const hint = q('profile-stats-scoreboard-hint');
      expect(hint).not.toBeNull();
      await act(async () => {
        hint!.click();
        await flush();
      });

      expect(q('profile-stats-tooltip')).not.toBeNull();
    });

    it('tooltip closes when the backdrop is pressed', async () => {
      const { ProfileStats } = await import('../ProfileStats.js');
      await renderEl(
        <ProfileStats
          progress={activeProgress}
          stats={activeStats}
          gamificationEnabled={true}
          viewMode="owner"
          testID="profile-stats"
        />,
      );

      await act(async () => {
        q('profile-stats-scoreboard-hint')!.click();
        await flush();
      });
      expect(q('profile-stats-tooltip')).not.toBeNull();

      // Chunk 38 exposes `${testID}-backdrop` as a Pressable that
      // dispatches onClose. Press it to mirror the real backdrop-tap
      // dismiss path. We do NOT read `props.visible` directly: the Modal
      // mock unmounts its subtree when invisible, so a closed tooltip is
      // simply absent from the DOM.
      const backdrop = q('profile-stats-tooltip-backdrop');
      expect(backdrop).not.toBeNull();
      await act(async () => {
        backdrop!.click();
        await flush();
      });

      expect(q('profile-stats-tooltip')).toBeNull();
    });
  });
});
