// @vitest-environment jsdom
// apps/mobile/src/hooks/usePremiumSlot.test.tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const subscription = { current: { active: false } as { active: boolean } | null };
vi.mock('./usePremiumSubscription', () => ({
  usePremiumSubscription: () => ({ subscription: subscription.current, loading: false }),
}));
vi.mock('../screens/caixa/caixa-enabled', () => ({ isCaixaBuildEnabled: () => true }));
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

afterEach(() => {
  last = undefined;
});

describe('usePremiumSlot', () => {
  it('returns caixa when the member is active and the feature is on', async () => {
    subscription.current = { active: true };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('caixa');
  });

  it('returns assinaturas for a free user', async () => {
    subscription.current = { active: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('assinaturas');
  });
});
