import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

const updateAdminStoreOrderFulfillment =
  vi.fn<(id: string, payload: unknown) => Promise<unknown>>();
const requestAdminOrderRefund = vi.fn<(id: string, payload: unknown) => Promise<unknown>>();
vi.mock('./admin-api', () => ({
  updateAdminStoreOrderFulfillment: (id: string, payload: unknown) =>
    updateAdminStoreOrderFulfillment(id, payload),
  requestAdminOrderRefund: (id: string, payload: unknown) => requestAdminOrderRefund(id, payload),
}));

import { ApiError } from './api';
import { requestOrderRefundAction, updateOrderFulfillmentAction } from './store-orders-actions';

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

// Task 9: the refund screen's copy for each of POST /admin/orders/:id/refund's
// error codes (task 8's contract) is owned by this action, not the component
// — so it is pinned here against real ApiError instances, not a mock string.
describe('requestOrderRefundAction', () => {
  beforeEach(() => {
    requestAdminOrderRefund.mockReset();
  });

  it('requests the refund and reports it as REQUESTED, not completed', async () => {
    requestAdminOrderRefund.mockResolvedValue({ requested: true, provider: 'stripe' });

    const result = await requestOrderRefundAction('order-1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });

    expect(result).toEqual({ ok: true, requested: true });
    expect(requestAdminOrderRefund).toHaveBeenCalledWith('order-1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });
    // Both surfaces: the store queue and the kind-agnostic /pedidos/[id].
    // The refresh picks up the new audit row, not a status change.
    expect(revalidatePath).toHaveBeenCalledWith('/loja/pedidos/order-1');
    expect(revalidatePath).toHaveBeenCalledWith('/pedidos/order-1');
  });

  it('rejects a reason shorter than 10 chars before calling the API', async () => {
    const result = await requestOrderRefundAction('order-1', { reason: 'curto' });

    expect(result.ok).toBe(false);
    expect(requestAdminOrderRefund).not.toHaveBeenCalled();
  });

  it.each([
    ['NotFound', 404, /não encontrado/i],
    ['OrderNotRefundable', 422, /pago/i],
    ['RefundNotSupported', 501, /AbacatePay/i],
    ['PartialRefundNotSupported', 422, /dashboard da Stripe/i],
    ['RefundAlreadyRequested', 409, /andamento/i],
    // Distinto de RefundAlreadyRequested: aqui nao existe webhook para
    // esperar, entao a copia tem que dizer para NAO esperar.
    ['RefundStuck', 409, /não espere pelo webhook/i],
    // Distinto de RefundFailed: nada saiu daqui, nenhum dinheiro se moveu.
    ['RefundNotAttempted', 503, /nada foi enviado à Stripe/i],
    ['RefundFailed', 502, /Stripe recusou/i],
  ] as const)('maps %s (%i) to an actionable message', async (code, status, pattern) => {
    requestAdminOrderRefund.mockRejectedValue(new ApiError(status, code, 'raw api message'));

    const result = await requestOrderRefundAction('order-1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  });

  it('maps a bare 403 to a permission message', async () => {
    requestAdminOrderRefund.mockRejectedValue(new ApiError(403, 'Forbidden', 'raw'));

    const result = await requestOrderRefundAction('order-1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/permissão/i);
  });

  it('maps a bare 429 to a rate-limit message', async () => {
    requestAdminOrderRefund.mockRejectedValue(new ApiError(429, 'TooManyRequests', 'raw'));

    const result = await requestOrderRefundAction('order-1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aguarde/i);
  });
});
