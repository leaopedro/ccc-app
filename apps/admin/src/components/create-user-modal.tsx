'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { createAdminUserAction } from '~/lib/admin-user-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

export function CreateUserModal() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setEmail('');
    setError(null);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    startTransition(async () => {
      setError(null);
      const result = await createAdminUserAction(trimmed);
      if (result.ok) {
        close();
        router.push(`/users/${result.id}`);
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
        className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold"
        aria-label="Criar usuário"
      >
        + Novo usuário
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="create-user-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="create-user-title" className="mb-1 text-lg font-semibold">
          Criar usuário
        </h2>
        <p className="mb-4 text-xs text-[color:var(--color-muted)]">
          O usuário será criado em estado parcial. Ele poderá definir a senha pelo fluxo de “esqueci
          a senha”.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Email</span>
            <input
              type="email"
              autoComplete="off"
              autoFocus
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              disabled={isPending || !email.trim()}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {isPending ? '...' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
