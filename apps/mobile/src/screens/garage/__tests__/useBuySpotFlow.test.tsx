// @vitest-environment jsdom
//
// useBuySpotFlow tests. Verifies the §C10 buy-spot return-path plumbing:
// after a successful cart-add the hook now threads `?return=garage&itemId=<id>`
// onto the `/cart` push so the future cart-success handler can bounce back.
//
// No `@testing-library/react` dep in `apps/mobile/package.json`. Reuse the
// `createRoot` + probe-component pattern from `HexBadge.test.tsx`.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type * as UseBuySpotFlowModule from '../useBuySpotFlow';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const pushMock = vi.fn();
const addToCartMock = vi.fn<() => Promise<{ cartId: string; itemId: string }>>();
const refreshMock = vi.fn<() => Promise<void>>();
const showMessageMock = vi.fn<(msg: string) => void>();

vi.mock('expo-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('~/api/garage', () => ({ addGarageSpotToCart: () => addToCartMock() }));
vi.mock('~/cart/context', () => ({ useCart: () => ({ refresh: refreshMock }) }));
vi.mock('~/copy/garage', () => ({ garageCopy: { garage: { buySpotFailed: 'fail' } } }));
vi.mock('~/lib/confirm', () => ({ showMessage: showMessageMock }));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let container: HTMLDivElement;
let root: Root;
type HookApi = ReturnType<typeof UseBuySpotFlowModule.useBuySpotFlow>;
const apiRef: { current: HookApi | null } = { current: null };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  [pushMock, addToCartMock, refreshMock, showMessageMock].forEach((m) => m.mockReset());
  apiRef.current = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await flush();
  });
  container.remove();
  vi.clearAllMocks();
});

// Probe captures the hook's return value into apiRef — no @testing-library/react.
const mount = async () => {
  const { useBuySpotFlow } = await import('../useBuySpotFlow');
  const Probe = () => {
    apiRef.current = useBuySpotFlow();
    return null;
  };
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
  return apiRef as { current: HookApi };
};

it('pushes /cart?return=garage&itemId=<id> after a successful cart-add', async () => {
  addToCartMock.mockResolvedValueOnce({ cartId: 'c1', itemId: 'item-9' });
  refreshMock.mockResolvedValueOnce(undefined);
  const api = await mount();
  await act(async () => {
    await api.current.goCheckout();
    await flush();
  });
  expect(pushMock).toHaveBeenCalledWith('/cart?return=garage&itemId=item-9');
});

it('skips the push when the sheet is closed mid-flight', async () => {
  addToCartMock.mockResolvedValueOnce({ cartId: 'c1', itemId: 'item-9' });
  refreshMock.mockResolvedValueOnce(undefined);
  const api = await mount();
  await act(async () => {
    api.current.openBuySheet({ purchaseOption: { displayPriceCents: 1000 } } as never);
    await flush();
  });
  const checkout = api.current.goCheckout();
  await act(async () => {
    api.current.closeBuySheet();
    await checkout;
    await flush();
  });
  expect(pushMock).not.toHaveBeenCalled();
});

it('surfaces failure copy when cart-add throws', async () => {
  addToCartMock.mockRejectedValueOnce(new Error('boom'));
  const api = await mount();
  await act(async () => {
    await api.current.goCheckout();
    await flush();
  });
  expect(pushMock).not.toHaveBeenCalled();
  expect(showMessageMock).toHaveBeenCalledWith('fail');
});
