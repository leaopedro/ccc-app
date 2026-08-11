'use client';

import {
  ADMIN_SUBSCRIPTION_ALLOWED_STATUS,
  type AdminSubscriptionStatus,
} from '@ccc/shared/admin-subscription';
import { useState } from 'react';

import { ActionToast, useActionToast } from './use-action-toast';

import { changePlanAction } from '~/lib/assinaturas-actions';

type Tier = 'bronze' | 'silver' | 'gold';
type Cadence = 'monthly' | 'annual';
type Status = AdminSubscriptionStatus;

type Props = {
  membershipId: string;
  mutable: boolean;
  status: Status;
  currentTier: Tier;
  currentCadence: Cadence;
};

const tierLabel: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const cadenceLabel: Record<Cadence, string> = { monthly: 'Mensal', annual: 'Anual' };

const field =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]';

export function PlanActions({ membershipId, mutable, status, currentTier, currentCadence }: Props) {
  const { pending, toast, run } = useActionToast();
  const [tier, setTier] = useState<Tier>(currentTier);
  const [cadence, setCadence] = useState<Cadence>(currentCadence);

  const statusAllowed = ADMIN_SUBSCRIPTION_ALLOWED_STATUS.plan.includes(status);
  const unchanged = tier === currentTier && cadence === currentCadence;
  const fieldDisabled = !mutable || !statusAllowed || pending;
  const disabled = fieldDisabled || unchanged;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <h2 className="text-lg font-semibold">Plano</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Tier
          <select
            className={field}
            value={tier}
            disabled={fieldDisabled}
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
            disabled={fieldDisabled}
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
