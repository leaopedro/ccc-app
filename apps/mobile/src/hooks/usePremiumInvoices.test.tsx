// @vitest-environment jsdom
//
// usePremiumInvoices tests (Task 23 regression). Mirrors
// usePremiumSubscription.test.tsx: the billing flag is a top-level const in
// `~/lib/premium-runtime` read from `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`
// at module-load time, so controlling it per test requires `vi.resetModules()`
// plus a dynamic re-import (same pattern as `screens/assinaturas/checkout.test.ts`).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const { listPremiumInvoices } = vi.hoisted(() => ({
  listPremiumInvoices: vi.fn(),
}));

vi.mock('~/api/premium-catalog', () => ({ listPremiumInvoices }));

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
  invoices: unknown[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

describe('usePremiumInvoices', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: HookResult | null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
    listPremiumInvoices.mockReset();
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
    const { usePremiumInvoices } = await import('./usePremiumInvoices');
    function Probe() {
      latest = usePremiumInvoices();
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
  it('calls listPremiumInvoices when the env var is "true"', async () => {
    listPremiumInvoices.mockResolvedValueOnce({ invoices: [{ periodStart: '2026-01-01' }] });
    await mount();
    expect(listPremiumInvoices).toHaveBeenCalledOnce();
    expect(latest?.invoices).toHaveLength(1);
    expect(latest?.loading).toBe(false);
  });

  it('never calls listPremiumInvoices when the env var is "false"', async () => {
    process.env[FLAG_VAR] = 'false';
    await mount();
    expect(listPremiumInvoices).not.toHaveBeenCalled();
    expect(latest?.invoices).toEqual([]);
    expect(latest?.loading).toBe(false);
  });

  // Semantics must stay "enabled only when explicitly 'true'" — guards
  // against a future edit that swaps to the store's "enabled unless
  // explicitly false" convention, which would silently enable billing in any
  // environment that forgets to set the var.
  it('treats an unset env var as disabled, not enabled', async () => {
    delete process.env[FLAG_VAR];
    await mount();
    expect(listPremiumInvoices).not.toHaveBeenCalled();
  });

  it('treats a 503 as an empty, non-error state rather than a hard error', async () => {
    const { ApiError } = (await import('~/api/client')) as unknown as {
      ApiError: new (status: number, message: string) => Error;
    };
    listPremiumInvoices.mockRejectedValueOnce(new ApiError(503, 'billing off'));
    await mount();
    expect(latest?.error).toBe(false);
    expect(latest?.invoices).toEqual([]);
  });
});
