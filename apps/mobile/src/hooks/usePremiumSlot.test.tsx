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
});
