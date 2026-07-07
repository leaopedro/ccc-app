'use client';

import { useRouter } from 'next/navigation';
import React, {
  type ChangeEvent,
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';

import {
  addGroupMemberAction,
  searchUsersAction,
  type UserSearchResult,
} from '~/lib/admin-group-actions';

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
  groupId: string;
}

export function AddGroupMemberModal({ groupId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setSelected(null);
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

  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      searchUsersAction(val.trim())
        .then((items) => setResults(items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  };

  const handleAdd = () => {
    if (!selected) return;
    startTransition(async () => {
      setError(null);
      const result = await addGroupMemberAction(groupId, selected.id);
      if (result.ok) {
        showToast('success', 'Membro adicionado com sucesso!');
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
          className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold"
        >
          + Adicionar membro
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
        aria-labelledby="add-member-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="add-member-title" className="mb-4 text-lg font-semibold">
          Adicionar membro
        </h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Buscar usuário</span>
            <input
              type="text"
              autoFocus
              placeholder="Nome ou email..."
              value={query}
              onChange={handleQueryChange}
              className={inputCls}
            />
          </label>

          {searching && <p className="text-xs text-[color:var(--color-muted)]">Buscando...</p>}

          {results.length > 0 && !selected && (
            <ul className="flex flex-col divide-y divide-[color:var(--color-border)] rounded border border-[color:var(--color-border)]">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(u);
                      setResults([]);
                    }}
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-[color:var(--color-border)]"
                  >
                    <span className="text-sm font-medium">{u.name}</span>
                    <span className="text-xs text-[color:var(--color-muted)]">{u.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="flex items-center justify-between rounded border border-[color:var(--color-border)] px-3 py-2">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{selected.name}</span>
                <span className="text-xs text-[color:var(--color-muted)]">{selected.email}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
              >
                ✕
              </button>
            </div>
          )}

          {error ? (
            <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isPending || !selected}
              onClick={handleAdd}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {isPending ? '...' : 'Adicionar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
