'use server';

import { adminOrderRefundSchema, type AdminOrderRefund } from '@ccc/shared/admin';
import { adminStoreFulfillmentUpdateSchema } from '@ccc/shared/store';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requestAdminOrderRefund, updateAdminStoreOrderFulfillment } from './admin-api';
import { ApiError } from './api';
import type { StoreFormState } from './store-actions';

const blankToUndefined = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const updateOrderFulfillmentAction = async (
  orderId: string,
  _prev: StoreFormState,
  fd: FormData,
): Promise<StoreFormState> => {
  const parsed = adminStoreFulfillmentUpdateSchema.safeParse({
    status: fd.get('status'),
    trackingCode: blankToUndefined(fd.get('trackingCode')),
    note: blankToUndefined(fd.get('note')),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  try {
    await updateAdminStoreOrderFulfillment(orderId, parsed.data);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao atualizar fulfillment.' };
  }
  revalidatePath('/loja/pedidos');
  revalidatePath(`/loja/pedidos/${orderId}`);
  return { error: null };
};

export type RequestOrderRefundResult = { ok: true; requested: true } | { ok: false; error: string };

// Maps POST /admin/orders/:id/refund's error codes (task 8) to copy the
// operator can act on. Every branch names the next concrete step, not just
// "something failed" — see task-9-report.md for why each wording was chosen.
const errFromRefundApi = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.code === 'NotFound') return 'Pedido não encontrado.';
    if (err.code === 'OrderNotRefundable') {
      return 'Este pedido não pode ser reembolsado agora: precisa estar pago e ter uma referência da Stripe.';
    }
    if (err.code === 'RefundNotSupported') {
      return 'Reembolso de Pix não é possível por aqui. Use o dashboard da AbacatePay, manualmente.';
    }
    if (err.code === 'PartialRefundNotSupported') {
      return 'Reembolso parcial não é suportado por este formulário: o valor precisaria ser atribuído linha a linha, e o webhook de reembolso da Stripe não faz isso hoje. Use o dashboard da Stripe diretamente para um valor parcial.';
    }
    if (err.code === 'RefundAlreadyRequested') {
      return 'Já existe um pedido de reembolso em andamento para este pedido. Aguarde o webhook confirmar. Se ele não chegar, confira o reembolso no dashboard da Stripe antes de qualquer nova tentativa.';
    }
    // Não é "aguarde": uma tentativa anterior ficou sem desfecho registrado, e
    // esta tela não vai reenviar nunca mais para este pedido. Dizer "aguarde"
    // aqui faria o operador esperar por um webhook que não vem.
    if (err.code === 'RefundStuck') {
      return 'Uma tentativa anterior de reembolso ficou sem desfecho registrado, então esta tela não vai reenviar. Não espere pelo webhook: confira no dashboard da Stripe se o reembolso saiu e, se não saiu, faça por lá.';
    }
    // Distinto de RefundFailed de propósito: aqui a solicitação nem saiu daqui,
    // então dizer que "a Stripe recusou" seria mentira — e uma mentira cara,
    // porque o próximo passo do operador é reembolsar na mão no dashboard.
    if (err.code === 'RefundNotAttempted' || err.status === 503) {
      return 'Não deu para registrar a solicitação aqui, então nada foi enviado à Stripe e nenhum dinheiro se moveu. Tente de novo.';
    }
    if (err.code === 'RefundFailed' || err.status === 502) {
      return 'A Stripe recusou a solicitação de reembolso. Tente de novo em instantes ou reembolse pelo dashboard da Stripe.';
    }
    if (err.status === 403) return 'Você não tem permissão para reembolsar pedidos.';
    if (err.status === 429) {
      return 'Muitas solicitações de reembolso em pouco tempo. Aguarde um minuto e tente de novo.';
    }
    return err.message || 'Falha ao solicitar reembolso.';
  }
  return 'Falha ao solicitar reembolso.';
};

export const requestOrderRefundAction = async (
  orderId: string,
  input: AdminOrderRefund,
): Promise<RequestOrderRefundResult> => {
  const parsed = adminOrderRefundSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  try {
    await requestAdminOrderRefund(orderId, parsed.data);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: errFromRefundApi(e) };
  }
  // 202 means Stripe accepted the REQUEST, not that the order is refunded —
  // Order.status only flips later, when the charge.refunded webhook lands.
  // Revalidating here is still correct: it picks up the new
  // 'order.refund_requested' audit row in history, not a status change.
  //
  // Both surfaces: /loja/pedidos/[id] for store orders and /pedidos/[id] for
  // every other kind. Revalidating a path the order does not use is a no-op,
  // and this action is shared by both screens.
  revalidatePath(`/loja/pedidos/${orderId}`);
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: true, requested: true };
};
