'use client';

import {
  ADMIN_SUBSCRIPTION_ALLOWED_STATUS,
  type AdminSubscriptionStatus,
} from '@ccc/shared/admin-subscription';

import { ActionToast, useActionToast } from './use-action-toast';

import {
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
} from '~/lib/assinaturas-actions';

type Props = {
  membershipId: string;
  mutable: boolean;
  status: AdminSubscriptionStatus;
};

const {
  cancel: CANCELABLE,
  resume: RESUMABLE,
  pause: PAUSABLE,
} = ADMIN_SUBSCRIPTION_ALLOWED_STATUS;

const btn =
  'rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40';

export function StatusActions({ membershipId, mutable, status }: Props) {
  const { pending, toast, run } = useActionToast();
  const disabled = !mutable || pending;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <h2 className="text-lg font-semibold">Status</h2>
      <div className="flex flex-wrap gap-2">
        {CANCELABLE.includes(status) ? (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            data-testid="assinaturas-acao-cancelar"
            onClick={() => run(() => cancelSubscriptionAction(membershipId))}
          >
            Cancelar ao fim do período
          </button>
        ) : null}
        {RESUMABLE.includes(status) ? (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            data-testid="assinaturas-acao-retomar"
            onClick={() => run(() => resumeSubscriptionAction(membershipId))}
          >
            Retomar
          </button>
        ) : null}
        {PAUSABLE.includes(status) ? (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            data-testid="assinaturas-acao-pausar"
            onClick={() => run(() => pauseSubscriptionAction(membershipId))}
          >
            Pausar cobrança
          </button>
        ) : null}
      </div>
      <p className="text-xs text-[color:var(--color-muted)]">
        A alteração é enviada ao provedor e confirmada por webhook. O valor na tela só muda depois
        da confirmação.
      </p>
      <ActionToast toast={toast} />
    </div>
  );
}
