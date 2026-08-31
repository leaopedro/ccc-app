// @vitest-environment jsdom
//
// Platform-gate test for ContratarScreen: the server answers `subscriptionsEnabled`
// alongside the plan on GET /api/plans/:slug, and the screen must not render
// the checkout CTA when it is false. Harness mirrors ContratarScreen.test.tsx
// (createRoot/act over a jsdom-mocked react-native, not RTL).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PremiumAddonModule,
  PremiumPlan,
  PremiumPlanDetailResponse,
} from '@ccc/shared/premium-catalog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getPremiumPlan = vi.fn<(slug: string) => Promise<PremiumPlanDetailResponse>>();

const platform = { OS: 'android' as string };

const hookState = vi.hoisted(() => ({
  modules: {
    modules: [] as PremiumAddonModule[],
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
}));

vi.mock('~/api/premium-catalog', () => ({
  getPremiumPlan: (slug: string) => getPremiumPlan(slug),
}));

vi.mock('~/hooks/usePremiumAddonModules', () => ({
  usePremiumAddonModules: () => hookState.modules,
}));

vi.mock('~/screens/assinaturas/checkout', () => ({
  startPremiumCheckout: vi.fn(),
}));

vi.mock('~/payments/payment-sheet', () => ({
  usePaymentSheet: () => ({ pay: vi.fn() }),
}));

vi.mock('~/screens/assinaturas/poll-subscription', () => ({
  pollSubscriptionActive: vi.fn(),
}));

vi.mock('~/lib/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace: vi.fn(), push: vi.fn() },
}));

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        pointerEvents,
        contentContainerStyle,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void className;
      void accessibilityState;
      void hitSlop;
      void pointerEvents;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    Platform: platform,
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

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { ArrowLeft: icon };
});

const goldPlan: PremiumPlan = {
  tier: 'gold',
  slug: 'fundador',
  name: 'Fundador',
  description: null,
  sortOrder: 0,
  prices: [{ cadence: 'monthly', baseAmountCents: 100000, currency: 'BRL' }],
  benefits: [],
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ContratarScreen platform gate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    platform.OS = 'android';
    getPremiumPlan.mockReset();
    hookState.modules = {
      modules: [],
      loading: false,
      error: false,
      refresh: () => Promise.resolve(),
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async (slug: string | undefined = 'fundador') => {
    const { default: ContratarScreen } = await import('../ContratarScreen');
    await act(async () => {
      root.render(<ContratarScreen slug={slug} />);
      await flush();
    });
  };

  it('does not render the subscribe CTA when the gate is off', async () => {
    // Flattened, not nested under `plan` (final review, Important 2) — the
    // real route now returns the plan fields at the top level.
    getPremiumPlan.mockResolvedValue({ ...goldPlan, subscriptionsEnabled: false });
    await renderScreen();
    expect(container.querySelector('[data-testid="contratar-cta"]')).toBeNull();
  });

  it('renders the subscribe CTA when the gate is on', async () => {
    getPremiumPlan.mockResolvedValue({ ...goldPlan, subscriptionsEnabled: true });
    await renderScreen();
    expect(container.querySelector('[data-testid="contratar-cta"]')).not.toBeNull();
  });
});
