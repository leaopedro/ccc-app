// @vitest-environment jsdom
//
// MinhaAssinaturaScreen tests. usePremiumSubscription is mocked to drive the
// active / inactive / billing-unavailable states.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type HookResult = {
  subscription: MySubscriptionResponse | null;
  loading: boolean;
  error: boolean;
  billingUnavailable: boolean;
  refresh: () => Promise<void>;
};

const replace = vi.fn();

const hookState = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock('~/hooks/usePremiumSubscription', () => ({
  usePremiumSubscription: () => hookState.value,
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
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { ArrowLeft: icon };
});

vi.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: vi.fn(), replace },
}));

const activeSub: MySubscriptionResponse = {
  active: true,
  tier: 'gold',
  planSlug: 'fundador',
  planName: 'Fundador',
  cadence: 'monthly',
  currentPeriodEnd: '2026-08-22T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  totalAmountCents: 164000,
  currency: 'BRL',
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      status: 'active',
      quotaUnit: 'access',
      quotaPerCycle: 3,
      currentCycle: {
        cycleStart: '2026-07-22T00:00:00.000Z',
        cycleEnd: '2026-08-22T00:00:00.000Z',
        quotaTotal: 3,
        quotaUsed: 1,
        quotaRemaining: 2,
      },
    },
  ],
};

const inactiveSub: MySubscriptionResponse = {
  active: false,
  tier: null,
  planSlug: null,
  planName: null,
  cadence: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  baseAmountCents: 0,
  addonsAmountCents: 0,
  totalAmountCents: 0,
  currency: 'BRL',
  addons: [],
};

const result = (over: Partial<HookResult>): HookResult => ({
  subscription: null,
  loading: false,
  error: false,
  billingUnavailable: false,
  refresh: () => Promise.resolve(),
  ...over,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('MinhaAssinaturaScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    replace.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderScreen = async () => {
    const { default: MinhaAssinaturaScreen } = await import('../MinhaAssinaturaScreen');
    await act(async () => {
      root.render(<MinhaAssinaturaScreen />);
      await flush();
    });
  };

  it('renders the active subscription with tier, totals and add-on usage', async () => {
    hookState.value = result({ subscription: activeSub });
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('Fundador');
    expect(text).toContain('Detailing');
    // base + add-ons + total (cents → BRL)
    expect(text).toContain('1.490,00');
    expect(text).toContain('150,00');
    expect(text).toContain('1.640,00');
    // cycle usage
    expect(text).toContain('1 de 3 acessos usados');
    expect(text).toContain('2 restantes');
  });

  it('renders the empty state linking back to plans when inactive', async () => {
    hookState.value = result({ subscription: inactiveSub });
    await renderScreen();
    const text = container.textContent ?? '';
    expect(text).toContain('Você ainda não é assinante.');
    const cta = container.querySelector('[data-testid="assinatura-empty-cta"]') as HTMLElement | null;
    if (!cta) throw new Error('empty CTA not rendered');
    await act(async () => {
      cta.click();
      await flush();
    });
    expect(replace).toHaveBeenCalledWith('/assinaturas');
  });

  it('renders an informative state when billing is unavailable (503/flag off)', async () => {
    hookState.value = result({ billingUnavailable: true });
    await renderScreen();
    expect(container.textContent ?? '').toContain('Assinaturas em breve.');
  });
});
