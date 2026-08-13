// @vitest-environment jsdom
// Same pattern as useBoxPreferences.test.tsx: `vi.hoisted` for the confirmBox
// mock and an inline mock class for `ApiError` (the real `~/api/client`
// transitively imports react-native, which vitest can't transform in jsdom).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmBox } = vi.hoisted(() => ({ confirmBox: vi.fn() }));
vi.mock('~/api/box', () => ({ confirmBox: (input: unknown) => confirmBox(input) }));
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

import { useBoxConfirm } from './useBoxConfirm';

// `vi.mock` swaps the runtime class, but TS still type-checks `ApiError`
// against the real module (whose constructor is `(status, message, body?)`).
// Cast to the mock's actual shape so the test can construct it.
const ApiError = RealApiError as unknown as new (status: number, body?: unknown) => Error;

let snap: ReturnType<typeof useBoxConfirm>;
function Probe() {
  snap = useBoxConfirm();
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => confirmBox.mockReset());

async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
}

describe('useBoxConfirm', () => {
  it('returns ok on success', async () => {
    confirmBox.mockResolvedValueOnce({});
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('ok');
  });

  it('maps a 400 ApiError to bad_address', async () => {
    confirmBox.mockRejectedValueOnce(new ApiError(400, { error: 'bad_address' }));
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('bad_address');
  });

  it('maps a 409 ApiError to box_locked', async () => {
    confirmBox.mockRejectedValueOnce(new ApiError(409, { error: 'box_locked' }));
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('box_locked');
  });

  it('maps other failures to error', async () => {
    confirmBox.mockRejectedValueOnce(new Error('net'));
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('error');
  });
});
