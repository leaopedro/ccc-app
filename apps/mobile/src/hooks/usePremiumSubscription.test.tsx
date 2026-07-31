// @vitest-environment jsdom
//
// usePremiumSubscription tests (Task 23 regression). The billing flag used to
// be read from `Constants.expoConfig?.extra` — expo-constants' web
// implementation resolves that from `process.env.APP_MANIFEST`, which this
// app never sets, so `expoConfig` is always empty on web and the hook
// silently treated billing as off regardless of the actual env var. The flag
// now comes from `~/lib/premium-runtime`, which reads
// `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` directly.
//
// That flag is a top-level const evaluated once at module load, so flipping
// it between tests requires `vi.resetModules()` plus a dynamic re-import of
// the hook module — same pattern as `screens/assinaturas/checkout.test.ts`.
// A static top-level import would only ever observe whichever value the env
// var held on the very first import of the file.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const { getMyPremiumSubscription } = vi.hoisted(() => ({
  getMyPremiumSubscription: vi.fn(),
}));

vi.mock('~/api/premium-catalog', () => ({ getMyPremiumSubscription }));

// Real ApiError (not vi.fn()) so `err instanceof ApiError` inside the hook's
// catch branch behaves exactly like production.
vi.mock('~/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

const FLAG_VAR = 'EXPO_PUBLIC_PREMIUM_BILLING_ENABLED';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

type HookResult = {
  subscription: unknown;
  loading: boolean;
  error: boolean;
  billingUnavailable: boolean;
  refresh: () => Promise<void>;
};

describe('usePremiumSubscription', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: HookResult | null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
    getMyPremiumSubscription.mockReset();
    vi.resetModules();
    process.env[FLAG_VAR] = 'true';
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
    delete process.env[FLAG_VAR];
  });

  const mount = async () => {
    const { usePremiumSubscription } = await import('./usePremiumSubscription');
    function Probe() {
      latest = usePremiumSubscription();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await flush();
      await flush();
    });
  };

  // The actual regression: a truthy env var must reach the hook and trigger
  // the real API call. Fails if the flag reverts to reading `Constants`
  // (always empty on web) instead of `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`.
  it('calls the subscription endpoint and clears billingUnavailable when the env var is "true"', async () => {
    getMyPremiumSubscription.mockResolvedValueOnce({ active: false });
    await mount();
    expect(getMyPremiumSubscription).toHaveBeenCalledOnce();
    expect(latest?.billingUnavailable).toBe(false);
    expect(latest?.loading).toBe(false);
  });

  it('never calls the endpoint and reports billingUnavailable when the env var is "false"', async () => {
    process.env[FLAG_VAR] = 'false';
    await mount();
    expect(getMyPremiumSubscription).not.toHaveBeenCalled();
    expect(latest?.billingUnavailable).toBe(true);
    expect(latest?.loading).toBe(false);
  });

  // Semantics must stay "enabled only when explicitly 'true'" — an unset var
  // must disable the feature, not enable it. Guards against a future edit
  // that swaps the check to the store's "enabled unless explicitly false"
  // convention (`!== 'false'`), which would silently turn billing on in every
  // environment that forgets to set the var.
  it('treats an unset env var as disabled, not enabled', async () => {
    delete process.env[FLAG_VAR];
    await mount();
    expect(getMyPremiumSubscription).not.toHaveBeenCalled();
    expect(latest?.billingUnavailable).toBe(true);
  });

  it('treats a 503 from the endpoint as billing-unavailable rather than a hard error', async () => {
    const { ApiError } = (await import('~/api/client')) as unknown as {
      ApiError: new (status: number, message: string) => Error;
    };
    getMyPremiumSubscription.mockRejectedValueOnce(new ApiError(503, 'billing off'));
    await mount();
    expect(latest?.billingUnavailable).toBe(true);
    expect(latest?.error).toBe(false);
  });
});
