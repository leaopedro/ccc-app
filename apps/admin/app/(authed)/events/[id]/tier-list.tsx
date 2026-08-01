'use client';

import type { AdminTicketTier } from '@ccc/shared/admin';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createTierAction,
  deleteTierAction,
  updateTierAction,
  type TierFormState,
} from '~/lib/tier-actions';

const initial: TierFormState = { error: null };

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

const TierRow = ({ eventId, tier }: { eventId: string; tier: AdminTicketTier }) => {
  const [state, action] = useActionState(updateTierAction.bind(null, eventId, tier.id), initial);
  const [priceReais, setPriceReais] = useState((tier.priceCents / 100).toFixed(2));
  const previewDisplayCents = Math.round(Number(priceReais) * 100 * (1 + tier.devFeePercent / 100));
  return (
    <tr className="border-b border-[color:var(--color-border)]">
      <td className="py-2">
        <form action={action} className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={tier.name}
            className="w-32 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <input
            name="priceReais"
            type="number"
            min={0}
            step={0.01}
            value={priceReais}
            onChange={(e) => setPriceReais(e.target.value)}
            className="w-24 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <span className="flex flex-col text-xs text-[color:var(--color-muted)]">
            <span>Taxa: {tier.devFeePercent}%</span>
            <span>Preço final: {formatBRL(previewDisplayCents)}</span>
          </span>
          <input
            name="quantityTotal"
            type="number"
            min={0}
            defaultValue={tier.quantityTotal}
            className="w-24 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <label className="flex items-center gap-1 text-sm">
            <input
              name="requiresCar"
              type="checkbox"
              defaultChecked={tier.requiresCar}
              value="true"
            />
            Associar carro (piloto)
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              name="isPremiumGrantable"
              type="checkbox"
              defaultChecked={tier.isPremiumGrantable}
              value="true"
              aria-label="Conceder a membros premium na publicação"
            />
            Conceder a membros premium na publicação
          </label>
          <Submit label="Salvar" />
          {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
        </form>
      </td>
      <td className="pl-2 text-sm">{formatBRL(tier.displayPriceCents)}</td>
      <td className="pl-2 text-sm">
        {tier.quantitySold}/{tier.quantityTotal}
      </td>
      <td>
        <form
          action={() => {
            void deleteTierAction(eventId, tier.id);
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

export const TierList = ({ eventId, tiers }: { eventId: string; tiers: AdminTicketTier[] }) => {
  const [state, action] = useActionState(createTierAction.bind(null, eventId), initial);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Ingressos</h2>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Tier</th>
            <th className="pl-2">Preço</th>
            <th className="pl-2">Vendidos</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <TierRow key={t.id} eventId={eventId} tier={t} />
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
          <span className="text-xs text-[color:var(--color-muted)]">Preço (R$)</span>
          <input
            name="priceReais"
            type="number"
            min={0}
            step={0.01}
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Quantidade</span>
          <input
            name="quantityTotal"
            type="number"
            min={0}
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 self-end pb-1 text-sm">
          <input name="requiresCar" type="checkbox" value="true" />
          Associar carro (piloto)
        </label>
        <label className="flex items-center gap-1 self-end pb-1 text-sm">
          <input
            name="isPremiumGrantable"
            type="checkbox"
            value="true"
            aria-label="Conceder a membros premium na publicação"
          />
          Conceder a membros premium na publicação
        </label>
        <Submit label="Adicionar" />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </form>
    </section>
  );
};
