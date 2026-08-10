'use client';

import type { AdminBoxSettings } from '@ccc/shared/admin-box';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { updateBoxSettingsAction, type BoxFormState } from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };
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

export const BoxSettingsClient = ({ settings }: { settings: AdminBoxSettings }) => {
  const [state, action] = useActionState(updateBoxSettingsAction, initial);
  const cepText = settings.freeShippingCepRanges.map((r) => `${r.from}:${r.to}`).join('\n');
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4"
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="boxEnabled" defaultChecked={settings.boxEnabled} /> Box
        habilitado
      </label>
      <label className={labelCls}>
        Dias de cutoff antes da renovacao
        <input
          name="cutoffDaysBeforeRenewal"
          type="number"
          min={0}
          max={28}
          defaultValue={settings.cutoffDaysBeforeRenewal}
          className={`${inputCls} w-24`}
        />
      </label>
      <label className={labelCls}>
        Titulo do header
        <input
          name="headerTitle"
          maxLength={140}
          defaultValue={settings.headerTitle ?? ''}
          className={inputCls}
        />
      </label>
      <label className={labelCls}>
        Subtitulo do header
        <input
          name="headerSubtitle"
          maxLength={240}
          defaultValue={settings.headerSubtitle ?? ''}
          className={inputCls}
        />
      </label>
      <label className={labelCls}>
        Frete padrao fora da regiao (centavos)
        <input
          name="shippingFeeCents"
          type="number"
          min={0}
          defaultValue={settings.shippingFeeCents}
          className={`${inputCls} w-28`}
        />
      </label>
      <label className={labelCls}>
        Faixas de CEP com frete gratis (uma por linha, formato de:ate)
        <textarea
          name="freeShippingCepRanges"
          rows={4}
          defaultValue={cepText}
          className={inputCls}
          placeholder="80000-000:83800-999"
        />
      </label>
      <div className="flex items-center gap-3">
        <Submit />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </div>
    </form>
  );
};
