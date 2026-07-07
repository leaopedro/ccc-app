'use client';

import type { AdminStoreOrderDetail } from '@jdm/shared/admin';
import type { StoreFulfillmentStatus } from '@jdm/shared/store';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FULFILLMENT_STATUS_LABEL } from '../status-labels';

import { updateOrderFulfillmentAction } from '~/lib/store-orders-actions';

type Props = {
  order: AdminStoreOrderDetail;
  allowedTransitions: StoreFulfillmentStatus[];
};

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
    >
      {pending ? 'Salvando…' : 'Atualizar status'}
    </button>
  );
};

export const FulfillmentForm = ({ order, allowedTransitions }: Props) => {
  const action = updateOrderFulfillmentAction.bind(null, order.id);
  const [state, dispatch] = useActionState(action, { error: null });

  if (allowedTransitions.length === 0) {
    return (
      <div className="text-sm text-[color:var(--color-muted)]">
        Nenhuma transição disponível a partir de{' '}
        <strong>{FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus]}</strong>.
      </div>
    );
  }

  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[color:var(--color-muted)]">Novo status</span>
        <select
          name="status"
          defaultValue={allowedTransitions[0]}
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
          required
        >
          {allowedTransitions.map((s) => (
            <option key={s} value={s}>
              {FULFILLMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[color:var(--color-muted)]">Código de rastreio (opcional)</span>
        <input
          name="trackingCode"
          defaultValue={order.trackingCode ?? ''}
          maxLength={120}
          placeholder="BR123456789"
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[color:var(--color-muted)]">Nota interna (opcional)</span>
        <textarea
          name="note"
          rows={3}
          maxLength={500}
          className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
        />
      </label>
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      <Submit />
    </form>
  );
};
