// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkoutBox } = vi.hoisted(() => ({ checkoutBox: vi.fn() }));
vi.mock('~/api/box', () => ({ checkoutBox: () => checkoutBox() }));
vi.mock('~/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, body?: unknown) {
      super('x');
      this.status = status;
      this.body = body;
    }
  },
}));

import { ApiError as RealApiError } from '~/api/client';
import { useBoxPay } from './useBoxPay';

const ApiError = RealApiError as unknown as new (status: number, body?: unknown) => Error;

let snap: ReturnType<typeof useBoxPay>;
function Probe() {
  snap = useBoxPay();
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => checkoutBox.mockReset());
async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
}

describe('useBoxPay', () => {
  it('returns ok + data on success', async () => {
    checkoutBox.mockResolvedValueOnce({ brCode: 'x', amountCents: 2000, expiresAt: 'z' });
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('ok');
  });

  it('maps 409 box_locked to locked', async () => {
    checkoutBox.mockRejectedValueOnce(new ApiError(409, { error: 'box_locked' }));
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('locked');
  });

  it('maps 409 box_not_awaiting to not_awaiting', async () => {
    checkoutBox.mockRejectedValueOnce(new ApiError(409, { error: 'box_not_awaiting' }));
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('not_awaiting');
  });

  it('maps 503 to unavailable and other errors to error', async () => {
    checkoutBox.mockRejectedValueOnce(new ApiError(503, { error: 'payment_unavailable' }));
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('unavailable');
    checkoutBox.mockRejectedValueOnce(new Error('net'));
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('error');
  });
});
