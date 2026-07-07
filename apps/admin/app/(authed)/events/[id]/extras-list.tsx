'use client';

import type { AdminExtra } from '@jdm/shared/admin';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createExtraAction,
  deleteExtraAction,
  updateExtraAction,
  type ExtraFormState,
} from '~/lib/extra-actions';

const initial: ExtraFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ExtraRow = ({ eventId, extra }: { eventId: string; extra: AdminExtra }) => {
  const [state, action] = useActionState(updateExtraAction.bind(null, eventId, extra.id), initial);
  const [priceCents, setPriceCents] = useState(extra.priceCents);
  const previewDisplayCents = Math.round(priceCents * (1 + extra.devFeePercent / 100));
  return (
    <tr className="border-b border-[color:var(--color-border)]">
      <td className="py-2">
        <form action={action} className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={extra.name}
            className="w-32 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <input
            name="priceCents"
            type="number"
            min={0}
            value={priceCents}
            onChange={(e) => setPriceCents(Number(e.target.value))}
            className="w-24 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <span className="flex flex-col text-xs text-[color:var(--color-muted)]">
            <span>Taxa: {extra.devFeePercent}%</span>
            <span>Preço final: {formatBRL(previewDisplayCents)}</span>
          </span>
          <input
            name="quantityTotal"
            type="number"
            min={0}
            defaultValue={extra.quantityTotal ?? ''}
            placeholder="∞"
            className="w-20 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <input
            name="sortOrder"
            type="number"
            defaultValue={extra.sortOrder}
            className="w-16 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="active" defaultChecked={extra.active} value="true" />
            Ativo
          </label>
          <Submit label="Salvar" />
          {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
        </form>
      </td>
      <td className="text-sm">{formatBRL(extra.displayPriceCents)}</td>
      <td className="text-sm">{extra.quantityTotal ?? '∞'}</td>
      <td className="text-sm">{extra.active ? 'Sim' : 'Não'}</td>
      <td>
        <form
          action={() => {
            void deleteExtraAction(eventId, extra.id);
          }}
        >
          <button type="submit" className="text-sm text-red-400 hover:underline">
            Remover
          </button>
        </form>
      </td>
    </tr>
  );
};

export const ExtrasList = ({ eventId, extras }: { eventId: string; extras: AdminExtra[] }) => {
  const [state, action] = useActionState(createExtraAction.bind(null, eventId), initial);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Extras</h2>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Extra</th>
            <th>Preço</th>
            <th>Estoque</th>
            <th>Ativo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {extras.map((e) => (
            <ExtraRow key={e.id} eventId={eventId} extra={e} />
          ))}
        </tbody>
      </table>
      <form
        action={action}
        className="flex items-end gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Nome</span>
          <input
            name="name"
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Preço (centavos)</span>
          <input
            name="priceCents"
            type="number"
            min={0}
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Estoque</span>
          <input
            name="quantityTotal"
            type="number"
            min={0}
            placeholder="∞ (vazio)"
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <Submit label="Adicionar" />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </form>
    </section>
  );
};
