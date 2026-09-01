// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { RequestOrderRefundResult } from '~/lib/store-orders-actions';

type ActionMock = (...args: unknown[]) => Promise<RequestOrderRefundResult>;

const requestOrderRefundAction = vi.fn<ActionMock>();

vi.mock('~/lib/store-orders-actions', () => ({
  requestOrderRefundAction: (...a: unknown[]) => requestOrderRefundAction(...a),
}));

const { RefundOrderForm } = await import('./refund-order-form');

let container: HTMLDivElement;
let root: Root;
let confirmSpy: MockInstance<(message?: string) => boolean>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  requestOrderRefundAction.mockReset();
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  confirmSpy.mockRestore();
});

// React's onChange reads through a value tracker installed on the prototype;
// setting `textarea.value = ...` directly bypasses it. Use the native setter
// so React fires onChange like a real keystroke would (same helper pattern
// as general-settings-form.interaction.test.tsx).
const setReason = async (value: string) => {
  const textarea = container.querySelector('textarea')!;
  const proto = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  /* eslint-disable @typescript-eslint/unbound-method -- intentional: invoke
     the prototype setter on `textarea` to bypass React's value tracker. */
  const setter = descriptor?.set;
  /* eslint-enable @typescript-eslint/unbound-method */
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
};

const submit = async () => {
  const form = container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('RefundOrderForm', () => {
  it('nao renderiza o formulario para pedido Pix', () => {
    act(() => {
      root.render(<RefundOrderForm orderId="ord_2" status="paid" provider="abacatepay" />);
    });
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toMatch(/suporte da AbacatePay/i);
  });

  it('nao renderiza o formulario para pedido ainda nao pago', () => {
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="pending" provider="stripe" />);
    });
    expect(container.querySelector('form')).toBeNull();
  });

  it('mantem o botao desabilitado ate o motivo ter 10 caracteres', async () => {
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" />);
    });
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await setReason('cliente desistiu dentro dos sete dias');
    expect(button.disabled).toBe(false);
  });

  // Fix round 2, MINOR. O formulario oferecia "Valor parcial em centavos
  // (opcional)", comportamento removido em 96205f7: a rota recusa com 422
  // qualquer amountCents diferente do total. O campo so podia dar erro ou um
  // reembolso total redundante.
  it('nao oferece campo de valor parcial e nao envia amountCents', async () => {
    confirmSpy.mockReturnValue(true);
    requestOrderRefundAction.mockResolvedValue({ ok: true, requested: true });
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" />);
    });
    expect(container.querySelector('input')).toBeNull();
    // A copy que sobrou aponta o parcial para fora do formulario, nao oferece.
    expect(container.textContent).toMatch(/só faz reembolso total/i);

    await setReason('cliente desistiu dentro dos sete dias');
    await submit();

    expect(requestOrderRefundAction).toHaveBeenCalledWith('ord_1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });
  });

  it('exige confirmacao antes de disparar a solicitacao', async () => {
    confirmSpy.mockReturnValue(false);
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" />);
    });
    await setReason('cliente desistiu dentro dos sete dias');
    await submit();

    expect(confirmSpy).toHaveBeenCalled();
    expect(requestOrderRefundAction).not.toHaveBeenCalled();
  });

  it('dispara a solicitacao somente apos confirmar', async () => {
    confirmSpy.mockReturnValue(true);
    requestOrderRefundAction.mockResolvedValue({ ok: true, requested: true });
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" />);
    });
    await setReason('cliente desistiu dentro dos sete dias');
    await submit();

    expect(requestOrderRefundAction).toHaveBeenCalledWith('ord_1', {
      reason: 'cliente desistiu dentro dos sete dias',
    });
  });

  it('avisa que o status so muda quando o webhook chegar', () => {
    act(() => {
      root.render(<RefundOrderForm orderId="ord_3" status="paid" provider="stripe" />);
    });
    expect(container.textContent).toMatch(/status.*muda.*webhook/i);
  });

  it('um 202 renderiza como "solicitado", nunca como "reembolsado"', async () => {
    requestOrderRefundAction.mockResolvedValue({ ok: true, requested: true });
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" />);
    });
    await setReason('cliente desistiu dentro dos sete dias');
    await submit();

    const outcome = container.querySelector('[role="status"]');
    expect(outcome?.textContent).toMatch(/solicitad/i);
    // The success message must say the refund was REQUESTED, never that it
    // completed — the order is still `paid` until the webhook lands. Check
    // only this specific outcome element, not the whole screen: the static
    // partial-amount disclaimer legitimately uses the word "reembolsado"
    // elsewhere on the page.
    expect(outcome?.textContent).not.toMatch(/\breembolsado\b/i);
  });

  // Per-error-code copy ("501 -> AbacatePay", "PartialRefundNotSupported ->
  // dashboard da Stripe", etc.) is produced and pinned in
  // store-orders-actions.test.ts, against real ApiError instances — that is
  // where the mapping actually lives. Here we only need proof that whatever
  // actionable string the action returns reaches the screen unmodified.
  it('renderiza a mensagem de erro devolvida pela action', async () => {
    requestOrderRefundAction.mockResolvedValue({
      ok: false,
      error: 'Reembolso de Pix não é possível por aqui. Use o dashboard da AbacatePay.',
    });
    act(() => {
      root.render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" />);
    });
    await setReason('cliente desistiu dentro dos sete dias');
    await submit();

    expect(container.textContent).toMatch(/dashboard da AbacatePay/i);
  });

  it('mostra o aviso de pedidos irmaos quando o carrinho tem mais de um pedido', () => {
    act(() => {
      root.render(
        <RefundOrderForm
          orderId="ord_1"
          status="paid"
          provider="stripe"
          siblingOrderCount={2}
          siblingTicketCount={3}
        />,
      );
    });
    expect(container.textContent).toMatch(/mais 2 pedido/i);
    expect(container.textContent).toMatch(/3 ingresso/i);
  });

  it('nao mostra o aviso de pedidos irmaos quando o pedido esta sozinho no carrinho', () => {
    act(() => {
      root.render(
        <RefundOrderForm
          orderId="ord_1"
          status="paid"
          provider="stripe"
          siblingOrderCount={0}
          siblingTicketCount={0}
        />,
      );
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
