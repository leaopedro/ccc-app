'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { updateGroupAction } from '~/lib/admin-group-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

interface Props {
  groupId: string;
  currentName: string;
  currentDescription: string | null;
}

export function EditGroupModal({ groupId, currentName, currentDescription }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription ?? '');
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setName(currentName);
    setDescription(currentDescription ?? '');
    setError(null);
  }, [currentName, currentDescription]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    startTransition(async () => {
      setError(null);
      const result = await updateGroupAction(groupId, trimmedName, description.trim() || null);
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm"
      >
        Editar
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="edit-group-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="edit-group-title" className="mb-4 text-lg font-semibold">
          Editar grupo
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Nome *</span>
            <input
              type="text"
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Descrição (opcional)</span>
            <textarea
              maxLength={500}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </label>

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
              type="submit"
              disabled={isPending || !name.trim()}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {isPending ? '...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
