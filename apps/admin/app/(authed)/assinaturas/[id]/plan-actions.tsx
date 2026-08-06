'use client';

import { useState } from 'react';

import { changePlanAction } from '~/lib/assinaturas-actions';

import { ActionToast, useActionToast } from './use-action-toast';

type Tier = 'bronze' | 'silver' | 'gold';
type Cadence = 'monthly' | 'annual';

type Props = {
  membershipId: string;
  mutable: boolean;
  currentTier: Tier;
  currentCadence: Cadence;
};

const tierLabel: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const cadenceLabel: Record<Cadence, string> = { monthly: 'Mensal', annual: 'Anual' };

const field =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]';

export function PlanActions({ membershipId, mutable, currentTier, currentCadence }: Props) {
  const { pending, toast, run } = useActionToast();
  const [tier, setTier] = useState<Tier>(currentTier);
  const [cadence, setCadence] = useState<Cadence>(currentCadence);

  const unchanged = tier === currentTier && cadence === currentCadence;
  const disabled = !mutable || pending || unchanged;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <h2 className="text-lg font-semibold">Plano</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Tier
          <select
            className={field}
            value={tier}
            disabled={!mutable || pending}
            data-testid="assinaturas-plano-tier"
            onChange={(e) => setTier(e.target.value as Tier)}
          >
            {(Object.keys(tierLabel) as Tier[]).map((t) => (
              <option key={t} value={t}>
                {tierLabel[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Cadência
          <select
            className={field}
            value={cadence}
            disabled={!mutable || pending}
            data-testid="assinaturas-plano-cadencia"
            onChange={(e) => setCadence(e.target.value as Cadence)}
          >
            {(Object.keys(cadenceLabel) as Cadence[]).map((c) => (
              <option key={c} value={c}>
                {cadenceLabel[c]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={disabled}
          data-testid="assinaturas-acao-trocar-plano"
          onClick={() => run(() => changePlanAction(membershipId, tier, cadence))}
        >
          Trocar plano
        </button>
      </div>
      <p className="text-xs text-[color:var(--color-muted)]">
        A diferença proporcional entra como crédito ou débito na próxima fatura. Nenhuma cobrança
        imediata fora do ciclo.
      </p>
      <ActionToast toast={toast} />
    </div>
  );
}
