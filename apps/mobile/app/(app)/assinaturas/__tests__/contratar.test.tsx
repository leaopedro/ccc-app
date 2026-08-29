// @vitest-environment jsdom
//
// contratar route: pins that the deep link is wired to useSubscriptionsGate
// (Task 10). ContratarScreen and PlanoDetalheScreen already hide their CTA
// when `subscriptionsEnabled` (per-plan response) is false, but that leaves
// a browsable package-builder screen with no way forward on a gated
// platform — this route must redirect away entirely instead of rendering
// that dead end. ContratarScreen itself is stubbed; its own behavior is
// covered by ContratarScreen.test.tsx.

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

vi.mock('~/screens/assinaturas/ContratarScreen', () => ({
  default: () => {
    screenRenderCount.current += 1;
    return null;
  },
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('contratar route', () => {
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
    const { default: ContratarRoute } = await import('../contratar');
    await act(async () => {
      root.render(<ContratarRoute />);
      await flush();
    });
  };

  it('redirects to /inicio and never renders ContratarScreen when the gate is off', async () => {
    plansState.current = { subscriptionsEnabled: false, loading: false };
    await renderRoute();

    expect(routerReplace).toHaveBeenCalledWith('/inicio');
    expect(screenRenderCount.current).toBe(0);
  });

  it('renders ContratarScreen without redirecting when the gate is on', async () => {
    plansState.current = { subscriptionsEnabled: true, loading: false };
    await renderRoute();

    expect(routerReplace).not.toHaveBeenCalled();
    expect(screenRenderCount.current).toBe(1);
  });
});
