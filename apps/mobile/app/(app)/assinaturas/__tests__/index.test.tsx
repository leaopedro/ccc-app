// @vitest-environment jsdom
//
// index route (PlanosScreen / "Planos disponíveis"): fix round 1, Task 10.
// This route is registered `href: null` at app/(app)/_layout.tsx:82 exactly
// like contratar and [slug] — just as deep-link-reachable — but Task 10
// missed it. PlanosScreen only hides its "Assinar" CTA per card
// (`showCta={subscriptionsEnabled}`); it never redirects, so a reviewer on a
// gated build would see a complete pricing page (tier, price, full benefit
// list) with no way to buy — the same browsable-dead-end pattern already
// fixed for contratar/[slug]. Gated identically here.
//
// PlanosScreen itself is stubbed; its own behavior is covered by
// PlanosScreen.test.tsx.

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
  useLocalSearchParams: () => ({ all: undefined }),
  router: { replace: routerReplace },
}));

vi.mock('~/screens/assinaturas/PlanosScreen', () => ({
  default: () => {
    screenRenderCount.current += 1;
    return null;
  },
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('assinaturas index route', () => {
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
    const { default: AssinaturasIndexRoute } = await import('../index');
    await act(async () => {
      root.render(<AssinaturasIndexRoute />);
      await flush();
    });
  };

  it('redirects to /inicio and never renders PlanosScreen when the gate is off', async () => {
    plansState.current = { subscriptionsEnabled: false, loading: false };
    await renderRoute();

    expect(routerReplace).toHaveBeenCalledWith('/inicio');
    expect(screenRenderCount.current).toBe(0);
  });

  it('does not render or redirect while the gate is loading', async () => {
    plansState.current = { subscriptionsEnabled: false, loading: true };
    await renderRoute();

    expect(routerReplace).not.toHaveBeenCalled();
    expect(screenRenderCount.current).toBe(0);
  });

  it('renders PlanosScreen without redirecting when the gate is on', async () => {
    plansState.current = { subscriptionsEnabled: true, loading: false };
    await renderRoute();

    expect(routerReplace).not.toHaveBeenCalled();
    expect(screenRenderCount.current).toBe(1);
  });
});
