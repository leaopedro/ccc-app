// @vitest-environment jsdom
//
// useSubscriptionsGate: the platform gate for the four assinaturas deep-link
// routes (contratar, [slug], and — deliberately not this hook, see the route
// files themselves — minha-assinatura / checkout-return). Hiding the premium
// tab does not remove the route, so a purchase-entry route must redirect
// itself away when `subscriptionsEnabled` (usePremiumPlans, Task 8) is off,
// and must render nothing while that answer is unknown — a reviewer landing
// on a subscribe screen that then errors is its own App Store finding.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const plansState = vi.hoisted(() => ({
  current: { subscriptionsEnabled: true, loading: false },
}));

vi.mock('~/hooks/usePremiumPlans', () => ({
  usePremiumPlans: () => ({
    plans: [],
    loading: plansState.current.loading,
    error: false,
    subscriptionsEnabled: plansState.current.subscriptionsEnabled,
    refresh: () => Promise.resolve(),
  }),
}));

const routerReplace = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({
  router: { replace: routerReplace },
}));

import { useSubscriptionsGate } from '../useSubscriptionsGate';

let last: boolean | undefined;
function Probe() {
  last = useSubscriptionsGate().canRender;
  return null;
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  last = undefined;
  routerReplace.mockClear();
  plansState.current = { subscriptionsEnabled: true, loading: false };
});

describe('useSubscriptionsGate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const render = async () => {
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
  };

  // Fail-closed: while usePremiumPlans hasn't resolved yet, the caller must
  // not render — and must not redirect either, since the answer isn't known.
  it('does not render and does not redirect while the plans fetch is loading', async () => {
    plansState.current = { subscriptionsEnabled: false, loading: true };
    await render();
    expect(last).toBe(false);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('lets the caller render once the gate resolves on', async () => {
    plansState.current = { subscriptionsEnabled: true, loading: false };
    await render();
    expect(last).toBe(true);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('redirects to /inicio and keeps the caller from rendering when the gate resolves off', async () => {
    plansState.current = { subscriptionsEnabled: false, loading: false };
    await render();
    expect(last).toBe(false);
    expect(routerReplace).toHaveBeenCalledWith('/inicio');
  });
});
