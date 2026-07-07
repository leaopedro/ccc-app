import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const updateAdminStoreOrderFulfillment =
  vi.fn<(id: string, payload: unknown) => Promise<unknown>>();
vi.mock('./admin-api', () => ({
  updateAdminStoreOrderFulfillment: (id: string, payload: unknown) =>
    updateAdminStoreOrderFulfillment(id, payload),
}));

import { updateOrderFulfillmentAction } from './store-orders-actions';

describe('updateOrderFulfillmentAction', () => {
  beforeEach(() => {
    updateAdminStoreOrderFulfillment.mockReset();
    updateAdminStoreOrderFulfillment.mockResolvedValue({});
  });

  it('normalizes blank trackingCode/note to undefined for non-shipped transitions', async () => {
    const fd = new FormData();
    fd.set('status', 'packed');
    fd.set('trackingCode', '');
    fd.set('note', '');

    const result = await updateOrderFulfillmentAction('order-1', { error: null }, fd);

    expect(result).toEqual({ error: null });
    expect(updateAdminStoreOrderFulfillment).toHaveBeenCalledTimes(1);
    const call = updateAdminStoreOrderFulfillment.mock.calls[0];
    expect(call).toBeDefined();
    const payload = call![1];
    expect(payload).toEqual({ status: 'packed' });
    expect(payload).not.toHaveProperty('trackingCode', '');
    expect(payload).not.toHaveProperty('note', '');
  });

  it('normalizes whitespace-only trackingCode to undefined', async () => {
    const fd = new FormData();
    fd.set('status', 'picked_up');
    fd.set('trackingCode', '   ');

    const result = await updateOrderFulfillmentAction('order-2', { error: null }, fd);

    expect(result).toEqual({ error: null });
    const call = updateAdminStoreOrderFulfillment.mock.calls[0];
    expect(call).toBeDefined();
    const payload = call![1];
    expect(payload).toEqual({ status: 'picked_up' });
  });

  it('forwards trimmed trackingCode for shipped transition', async () => {
    const fd = new FormData();
    fd.set('status', 'shipped');
    fd.set('trackingCode', '  BR1234  ');
    fd.set('note', '  saiu pelos correios  ');

    const result = await updateOrderFulfillmentAction('order-3', { error: null }, fd);

    expect(result).toEqual({ error: null });
    const call = updateAdminStoreOrderFulfillment.mock.calls[0];
    expect(call).toBeDefined();
    const payload = call![1];
    expect(payload).toEqual({
      status: 'shipped',
      trackingCode: 'BR1234',
      note: 'saiu pelos correios',
    });
  });

  it('still rejects shipped transition without trackingCode', async () => {
    const fd = new FormData();
    fd.set('status', 'shipped');
    fd.set('trackingCode', '');

    const result = await updateOrderFulfillmentAction('order-4', { error: null }, fd);

    expect(result.error).toBeTruthy();
    expect(updateAdminStoreOrderFulfillment).not.toHaveBeenCalled();
  });
});
