'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { setAdminUserGaragePremiumAction } from '~/lib/admin-garage-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

type Tier = 'bronze' | 'silver' | 'gold';

interface Props {
  userId: string;
  currentTier: Tier | null;
  currentUntil: string | null;
}

const tierLabels: Record<Tier, string> = {
  bronze: 'Bronze',
  silver: 'Prata',
  gold: 'Ouro',
};

const toDateInput = (iso: string | null) => {
  if (!iso) return '';
  // ISO → yyyy-mm-dd for <input type="date"> (UTC, no time conversion noise).
  return iso.slice(0, 10);
};

const fromDateInput = (date: string): string | null => {
  if (!date) return null;
  // Treat the picked date as end-of-day UTC so premium lasts the full day.
  return new Date(`${date}T23:59:59.000Z`).toISOString();
};

export function GrantGaragePremiumModal({ userId, currentTier, currentUntil }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>(currentTier ?? 'bronze');
  const [untilDate, setUntilDate] = useState<string>(toDateInput(currentUntil));

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    setTier(currentTier ?? 'bronze');
    setUntilDate(toDateInput(currentUntil));
  }, [currentTier, currentUntil]);

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

  const submit = () => {
    startTransition(async () => {
      setError(null);
      const res = await setAdminUserGaragePremiumAction(userId, {
        tier,
        premiumUntil: fromDateInput(untilDate),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]"
      >
        {currentTier ? 'Atualizar premium' : 'Conceder premium'}
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="grant-premium-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="grant-premium-title" className="mb-4 text-lg font-semibold">
          Conceder premium
        </h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Tier</span>
            <select
              autoFocus
              value={tier}
              onChange={(e) => setTier(e.target.value as Tier)}
              className={inputCls}
            >
              {(['bronze', 'silver', 'gold'] as const).map((t) => (
                <option key={t} value={t}>
                  {tierLabels[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">
              Válido até (opcional — vazio = sem expiração)
            </span>
            <input
              type="date"
              value={untilDate}
              onChange={(e) => setUntilDate(e.target.value)}
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
              type="button"
              disabled={isPending}
              onClick={submit}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
