'use client';

import { useState } from 'react';

import { attachAddonAction, detachAddonAction } from '~/lib/assinaturas-actions';

import { ActionToast, useActionToast } from './use-action-toast';

type Status = 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';

type Props = {
  membershipId: string;
  mutable: boolean;
  status: Status;
  /** Chaves ja vinculadas (qualquer status exceto cancelled), para nao
   * oferecer duplicata no select. NAO usar para o botao de remover: inclui
   * cancel_scheduled, cujo providerItemRef a Stripe ja apagou. */
  attachedKeys: string[];
  /**
   * Chaves com botao de remover — apenas status 'active'. Um cancel_scheduled
   * ja teve seu SubscriptionItem removido na Stripe; reenviar
   * removeSubscriptionItem ou responde do cache de idempotencia (<24h) ou
   * 500 em resource_missing (>24h), e re-anexar tambem falha (attachAddon so
   * aceita 'cancelled'). Opcional e cai em attachedKeys quando omitido, para
   * nao quebrar quem ainda nao passa este prop.
   */
  removableKeys?: string[];
  /** Catalogo de modulos ativos. Vem do server component pai. */
  moduleOptions?: Array<{ key: string; name: string }>;
};

/**
 * Espelha ALLOWED_STATUS.addon em apps/api/src/routes/admin/subscriptions.ts.
 * As duas listas precisam mudar juntas: divergir aqui deixa o botão
 * habilitado numa ação que a API vai recusar com 409.
 */
const ALLOWED_STATUS: Status[] = ['active', 'past_due', 'cancel_scheduled'];

export function AddonsPanel({
  membershipId,
  mutable,
  status,
  attachedKeys,
  removableKeys,
  moduleOptions = [],
}: Props) {
  const { pending, toast, run } = useActionToast();
  const statusAllowed = ALLOWED_STATUS.includes(status);
  const controlsDisabled = !mutable || !statusAllowed || pending;
  const available = moduleOptions.filter((m) => !attachedKeys.includes(m.key));
  const removable = removableKeys ?? attachedKeys;

  // O catalogo pode chegar depois de um refresh, e a selecao anterior pode
  // deixar de existir. Guarda so a escolha explicita do usuario e deriva o
  // valor efetivo no render — sem efeito, sem setState fora de um handler.
  const [override, setOverride] = useState<string | null>(null);
  const selected =
    override && available.some((m) => m.key === override) ? override : (available[0]?.key ?? '');

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Vincular módulo
          <select
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
            value={selected}
            disabled={controlsDisabled || available.length === 0}
            data-testid="assinaturas-modulo-select"
            onChange={(e) => setOverride(e.target.value)}
          >
            {available.length === 0 ? (
              <option value="">Nenhum módulo disponível</option>
            ) : (
              available.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={controlsDisabled || !selected}
          data-testid="assinaturas-acao-vincular-modulo"
          onClick={() => run(() => attachAddonAction(membershipId, selected))}
        >
          Vincular
        </button>
      </div>

      {removable.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {removable.map((key) => (
            <button
              key={key}
              type="button"
              className="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs disabled:opacity-40"
              disabled={controlsDisabled}
              data-testid={`assinaturas-acao-remover-modulo-${key}`}
              onClick={() => run(() => detachAddonAction(membershipId, key))}
            >
              Remover {key}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-[color:var(--color-muted)]">
        Vincular ou remover módulo aplica de imediato, com rateio na próxima fatura.
      </p>
      <ActionToast toast={toast} />
    </div>
  );
}
