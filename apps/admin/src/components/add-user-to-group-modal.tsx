'use client';

import { useRouter } from 'next/navigation';
import React, {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';

import { addGroupMemberAction, type GroupOption } from '~/lib/admin-group-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

const toastBaseCls =
  'pointer-events-none fixed right-4 top-4 z-[60] rounded border px-3 py-2 text-sm shadow-lg';

const clearTimer = (ref: MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
};

interface Props {
  userId: string;
  groups: GroupOption[];
  initialOpen?: boolean;
}

export function AddUserToGroupModal({ userId, groups, initialOpen = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(initialOpen);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSelectedGroupId('');
    setError(null);
  }, []);

  const showToast = (kind: 'success' | 'error', message: string) => {
    clearTimer(timerRef);
    setToast({ kind, message });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, 2400);
  };

  useEffect(() => {
    return () => {
      clearTimer(timerRef);
      clearTimer(closeTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleAdd = () => {
    if (!selectedGroupId) return;
    startTransition(async () => {
      setError(null);
      const result = await addGroupMemberAction(selectedGroupId, userId);
      if (result.ok) {
        showToast('success', 'Usuário adicionado ao grupo!');
        router.refresh();
        clearTimer(closeTimerRef);
        closeTimerRef.current = setTimeout(() => close(), 1200);
      } else {
        setError(result.error);
      }
    });
  };

  const toastEl = toast ? (
    <div
      role="status"
      aria-live="polite"
      className={`${toastBaseCls} ${
        toast.kind === 'success'
          ? 'border-green-500/50 bg-green-500/10 text-green-200'
          : 'border-red-500/50 bg-red-500/10 text-red-200'
      }`}
    >
      {toast.message}
    </div>
  ) : null;

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]"
        >
          + Adicionar a grupo
        </button>
        {toastEl}
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
      {toastEl}
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="add-to-group-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="add-to-group-title" className="mb-4 text-lg font-semibold">
          Adicionar a grupo
        </h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Grupo</span>
            <select
              autoFocus
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className={inputCls}
            >
              <option value="">Selecione um grupo...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!selectedGroupId || isPending}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {isPending ? 'Adicionando...' : 'Adicionar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
