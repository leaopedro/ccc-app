'use client';

import type { AdminPresaleSettings } from '@ccc/shared/admin';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { updatePresaleSettingsAction, type PresaleFormState } from '~/lib/presale-admin-actions';

const initial: PresaleFormState = { error: null };
const inputCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';
const labelCls = 'flex flex-col gap-1 text-xs text-[color:var(--color-muted)]';

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
    >
      {pending ? '...' : 'Salvar configuracoes'}
    </button>
  );
};

export const PresaleSettingsClient = ({ settings }: { settings: AdminPresaleSettings }) => {
  const [state, action] = useActionState(updatePresaleSettingsAction, initial);
  const cepText = settings.deliveryCepRanges.map((r) => `${r.start}:${r.end}`).join('\n');
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4"
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Pre-venda
        habilitada
      </label>
      <label className={labelCls}>
        Endereco de retirada
        <input
          name="pickupAddress"
          maxLength={280}
          defaultValue={settings.pickupAddress ?? ''}
          className={inputCls}
        />
      </label>
      <label className={labelCls}>
        Horario de retirada
        <input
          name="pickupHours"
          maxLength={100}
          defaultValue={settings.pickupHours ?? ''}
          className={inputCls}
          placeholder="10:00-18:00"
        />
      </label>
      <label className={labelCls}>
        Descricao da area de entrega
        <input
          name="deliveryAreaLabel"
          maxLength={140}
          defaultValue={settings.deliveryAreaLabel ?? ''}
          className={inputCls}
        />
      </label>
      <label className={labelCls}>
        Frete para entrega (centavos)
        <input
          name="shippingFeeCents"
          type="number"
          min={0}
          defaultValue={settings.shippingFeeCents}
          className={`${inputCls} w-28`}
        />
      </label>
      <label className={labelCls}>
        Faixas de CEP para entrega (uma por linha, formato inicio:fim)
        <textarea
          name="deliveryCepRanges"
          rows={4}
          defaultValue={cepText}
          className={inputCls}
          placeholder="80000-000:83800-999"
        />
      </label>
      <label className={labelCls}>
        Descricao do primeiro lote
        <input
          name="firstBatchLabel"
          maxLength={140}
          defaultValue={settings.firstBatchLabel ?? ''}
          className={inputCls}
        />
      </label>
      <div className="flex items-center gap-3">
        <Submit />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </div>
    </form>
  );
};
