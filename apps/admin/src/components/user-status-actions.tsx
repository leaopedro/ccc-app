'use client';

import type { UserStatusName } from '@jdm/shared/auth';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { UserStatusChip } from './user-status-chip';

import { disableAdminUserAction, enableAdminUserAction } from '~/lib/admin-user-actions';

type Props = {
  userId: string;
  initialStatus: UserStatusName;
};

const COPY = {
  disableLabel: 'Desabilitar conta',
  enableLabel: 'Reativar conta',
  disableTitle: 'Desabilitar conta',
  enableTitle: 'Reativar conta',
  disableExplain:
    'O usuário não poderá fazer login nem usar a conta até que ela seja reativada. Sessões ativas serão encerradas.',
  enableExplain:
    'O usuário voltará a ter acesso. Se ainda não tiver definido senha, o status volta para Parcial até a definição.',
  cancel: 'Cancelar',
  confirmDisable: 'Desabilitar',
  confirmEnable: 'Reativar',
} as const;

export function UserStatusActions({ userId, initialStatus }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<UserStatusName>(initialStatus);
  const [confirmKind, setConfirmKind] = useState<'disable' | 'enable' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setConfirmKind(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!confirmKind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmKind, close]);

  const isDisabled = status === 'disabled';

  const handleConfirm = () => {
    if (!confirmKind) return;
    startTransition(async () => {
      setError(null);
      const result =
        confirmKind === 'disable'
          ? await disableAdminUserAction(userId)
          : await enableAdminUserAction(userId);
      if (result.ok) {
        setStatus(result.status);
        close();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <UserStatusChip status={status} />
        <button
          type="button"
          onClick={() => setConfirmKind(isDisabled ? 'enable' : 'disable')}
          className={`rounded px-3 py-1.5 text-sm font-semibold ${
            isDisabled
              ? 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600'
              : 'bg-red-800 text-red-50 hover:bg-red-700'
          }`}
        >
          {isDisabled ? COPY.enableLabel : COPY.disableLabel}
        </button>
      </div>

      {confirmKind ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
          <div
            role="dialog"
            aria-modal={true}
            aria-labelledby="user-status-confirm-title"
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
          >
            <h2 id="user-status-confirm-title" className="mb-2 text-lg font-semibold">
              {confirmKind === 'disable' ? COPY.disableTitle : COPY.enableTitle}
            </h2>
            <p className="mb-4 text-sm text-[color:var(--color-muted)]">
              {confirmKind === 'disable' ? COPY.disableExplain : COPY.enableExplain}
            </p>

            {error ? (
              <p
                role="alert"
                className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm"
              >
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm"
              >
                {COPY.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                  confirmKind === 'disable'
                    ? 'bg-red-800 text-red-50'
                    : 'bg-emerald-700 text-emerald-50'
                }`}
              >
                {isPending
                  ? '...'
                  : confirmKind === 'disable'
                    ? COPY.confirmDisable
                    : COPY.confirmEnable}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
