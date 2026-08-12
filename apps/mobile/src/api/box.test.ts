import { describe, expect, it, vi, beforeEach } from 'vitest';

const authedRequest = vi.fn();
vi.mock('./client', () => ({ authedRequest: (...a: unknown[]) => authedRequest(...a) }));

import { getBox, updateBoxSelection, skipBox, setBoxPreferences } from './box';

describe('box api client', () => {
  beforeEach(() => authedRequest.mockReset().mockResolvedValue(undefined));

  it('getBox hits GET /me/box', async () => {
    await getBox();
    expect(authedRequest.mock.calls[0][0]).toBe('/me/box');
    expect(authedRequest.mock.calls[0][2]).toBeUndefined();
  });

  it('updateBoxSelection PUTs a parsed body to /me/box/selection', async () => {
    await updateBoxSelection({ items: [{ catalogItemId: 'c1', quantity: 2 }], partnerItems: [] });
    const [path, , opts] = authedRequest.mock.calls[0];
    expect(path).toBe('/me/box/selection');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toEqual({ items: [{ catalogItemId: 'c1', quantity: 2 }], partnerItems: [] });
  });

  it('skipBox POSTs /me/box/skip with no body', async () => {
    await skipBox();
    const [path, , opts] = authedRequest.mock.calls[0];
    expect(path).toBe('/me/box/skip');
    expect(opts.method).toBe('POST');
  });

  it('setBoxPreferences PUTs /me/box/preferences', async () => {
    await setBoxPreferences({ autoSendOptIn: true, shippingAddressId: 'a1' });
    const [path, , opts] = authedRequest.mock.calls[0];
    expect(path).toBe('/me/box/preferences');
    expect(opts.method).toBe('PUT');
  });
});
