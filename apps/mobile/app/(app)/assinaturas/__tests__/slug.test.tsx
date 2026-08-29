// @vitest-environment jsdom
//
// [slug] route (plan detail): same wiring as contratar.test.tsx — pins that
// this deep link is gated by useSubscriptionsGate (Task 10) instead of only
// hiding its own "Assinar" CTA. PlanoDetalheScreen is stubbed; its own
// behavior is covered by PlanoDetalheScreen.test.tsx.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const plansState = vi.hoisted(() => ({
  current: { subscriptionsEnabled: true, loading: false },
}));
const routerReplace = vi.hoisted(() => vi.fn());
const screenRenderCount = vi.hoisted(() => ({ current: 0 }));

vi.mock('~/hooks/usePremiumPlans', () => ({
  usePremiumPlans: () => ({
    plans: [],
    loading: plansState.current.loading,
    error: false,
    subscriptionsEnabled: plansState.current.subscriptionsEnabled,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ slug: 'fundador' }),
  router: { replace: routerReplace },
}));

vi.mock('~/screens/assinaturas/PlanoDetalheScreen', () => ({
  default: () => {
    screenRenderCount.current += 1;
    return null;
  },
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('[slug] route', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    routerReplace.mockClear();
    screenRenderCount.current = 0;
    plansState.current = { subscriptionsEnabled: true, loading: false };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderRoute = async () => {
    const { default: PlanoDetalheRoute } = await import('../[slug]');
    await act(async () => {
      root.render(<PlanoDetalheRoute />);
      await flush();
    });
  };

  it('redirects to /inicio and never renders PlanoDetalheScreen when the gate is off', async () => {
    plansState.current = { subscriptionsEnabled: false, loading: false };
    await renderRoute();

    expect(routerReplace).toHaveBeenCalledWith('/inicio');
    expect(screenRenderCount.current).toBe(0);
  });

  it('renders PlanoDetalheScreen without redirecting when the gate is on', async () => {
    plansState.current = { subscriptionsEnabled: true, loading: false };
    await renderRoute();

    expect(routerReplace).not.toHaveBeenCalled();
    expect(screenRenderCount.current).toBe(1);
  });
});
