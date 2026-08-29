// @vitest-environment jsdom
// apps/mobile/src/hooks/usePremiumSlot.test.tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SubState = {
  subscription: { active: boolean } | null;
  loading: boolean;
  error: boolean;
};
const subState: { current: SubState } = {
  current: { subscription: { active: false }, loading: false, error: false },
};
vi.mock('./usePremiumSubscription', () => ({
  usePremiumSubscription: () => ({
    subscription: subState.current.subscription,
    loading: subState.current.loading,
    error: subState.current.error,
    refresh: () => Promise.resolve(),
  }),
}));
type PlansState = { subscriptionsEnabled: boolean; loading: boolean; error: boolean };
const plansState: { current: PlansState } = {
  current: { subscriptionsEnabled: true, loading: false, error: false },
};
vi.mock('./usePremiumPlans', () => ({
  usePremiumPlans: () => ({
    subscriptionsEnabled: plansState.current.subscriptionsEnabled,
    loading: plansState.current.loading,
    error: plansState.current.error,
    refresh: () => Promise.resolve(),
  }),
}));
vi.mock('../screens/caixa/caixa-enabled', () => ({ isCaixaBuildEnabled: () => true }));
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store[k] ?? null),
    setItem: (k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    },
  },
}));

import { usePremiumSlot } from './usePremiumSlot';

let last: string | undefined;
function Probe() {
  last = usePremiumSlot().slot;
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  last = undefined;
  for (const k of Object.keys(store)) delete store[k];
  subState.current = { subscription: { active: false }, loading: false, error: false };
  plansState.current = { subscriptionsEnabled: true, loading: false, error: false };
});

describe('usePremiumSlot', () => {
  it('returns caixa when the member is active and the feature is on', async () => {
    subState.current = { subscription: { active: true }, loading: false, error: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('caixa');
  });

  it('returns assinaturas for a free user', async () => {
    subState.current = { subscription: { active: false }, loading: false, error: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('assinaturas');
  });

  it('empties the slot for a free user when subscriptions are gated', async () => {
    subState.current = { subscription: { active: false }, loading: false, error: false };
    plansState.current = { subscriptionsEnabled: false, loading: false, error: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('none');
  });

  it('keeps caixa for an active member even when subscriptions are gated', async () => {
    subState.current = { subscription: { active: true }, loading: false, error: false };
    plansState.current = { subscriptionsEnabled: false, loading: false, error: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('caixa');
  });

  it('keeps the cached active entitlement on a transient error, and does not overwrite it', async () => {
    store['caixa.premiumActive'] = 'true';
    subState.current = { subscription: null, loading: false, error: true };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    // Error falls back to the cached seed instead of reading as inactive.
    expect(last).toBe('caixa');
    // And the cached `true` is not clobbered by the failed request.
    expect(store['caixa.premiumActive']).toBe('true');
  });

  // Fix (final review, Important 3): the gate used to default to `false`
  // (fail-closed) on ANY plans error/loading state, which leaked to
  // web/Android — platforms where the gate is never actually off — and hid
  // the assinaturas tab there too. It must now fall back to the last
  // known-good persisted value, exactly like `premiumActive` above.
  it('keeps the cached gate=true on a transient /api/plans error instead of hiding the tab', async () => {
    store['caixa.subscriptionsEnabled'] = 'true';
    subState.current = { subscription: { active: false }, loading: false, error: false };
    plansState.current = { subscriptionsEnabled: false, loading: false, error: true };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('assinaturas');
    // And the cached `true` is not clobbered by the failed request.
    expect(store['caixa.subscriptionsEnabled']).toBe('true');
  });

  it('persists a known-good gate value once the plans fetch resolves', async () => {
    subState.current = { subscription: { active: false }, loading: false, error: false };
    plansState.current = { subscriptionsEnabled: true, loading: false, error: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(store['caixa.subscriptionsEnabled']).toBe('true');
  });

  // The deliberate fail-closed default must survive: with nothing ever
  // stored and the plans fetch itself failing, the gate still reads as off.
  it('still fails closed on a plans error when nothing has ever been cached', async () => {
    subState.current = { subscription: { active: false }, loading: false, error: false };
    plansState.current = { subscriptionsEnabled: false, loading: false, error: true };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('none');
  });
});
