'use client';

import type { AdminXpAdjustmentInput } from '@jdm/shared/admin-garage-xp';
import { useCallback, useEffect, useState } from 'react';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

export type AdminXpAdjustmentSubmitResult =
  | { ok: true; data: { xp: number } }
  | { ok: false; status: number; code: string };

interface Props {
  userId: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (input: AdminXpAdjustmentInput) => Promise<AdminXpAdjustmentSubmitResult>;
  gamificationDisabled?: boolean;
}

const errorCopy = (code: string | undefined): string => {
  switch (code) {
    case 'gamification_disabled':
      return 'Gamificação desativada.';
    case 'invalid_delta':
      return 'Delta inválido.';
    default:
      return 'Erro ao aplicar ajuste.';
  }
};

export function AdminXpAdjustmentModal({
  userId: _userId,
  open,
  onClose,
  onSubmit,
  gamificationDisabled = false,
}: Props) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setDelta('');
    setReason('');
    setError(null);
    setSubmitting(false);
  }, []);

  // Reset whenever the modal opens fresh so prior errors do not leak.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // canon §C7: `Number(delta)` + `Number.isInteger(...)` — NOT
  // `Number.parseInt`. `parseInt('1.5')` returns `1` and would bypass the
  // server's non-integer rejection. `parseInt('10abc')` returns `10` for the
  // same reason. Stick with `Number(...)` so the client mirrors the zod
  // refine exactly.
  const parsedDelta = Number(delta);
  const deltaValid =
    delta !== '' &&
    Number.isFinite(parsedDelta) &&
    Number.isInteger(parsedDelta) &&
    parsedDelta !== 0 &&
    parsedDelta >= -10_000 &&
    parsedDelta <= 10_000;
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= 3 && trimmedReason.length <= 120;
  const canSubmit = deltaValid && reasonValid && !submitting && !gamificationDisabled;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit({ delta: parsedDelta, reason: trimmedReason });
      setSubmitting(false);
      if (result.ok) {
        reset();
        onClose();
      } else {
        setError(errorCopy(result.code));
      }
    } catch {
      setSubmitting(false);
      setError(errorCopy(undefined));
    }
  }, [canSubmit, onSubmit, parsedDelta, trimmedReason, reset, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="admin-xp-adjustment-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="admin-xp-adjustment-title" className="mb-4 text-lg font-semibold">
          Ajuste manual de XP
        </h2>
        <div className="flex flex-col gap-4">
          {gamificationDisabled ? (
            <p className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-sm">
              Gamificação desativada — ajustes bloqueados.
            </p>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Delta</span>
            <input
              type="number"
              min={-10_000}
              max={10_000}
              step={1}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              className={inputCls}
              autoFocus
              aria-label="delta"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Motivo</span>
            <textarea
              maxLength={120}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputCls}
              rows={3}
              aria-label="motivo"
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
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => {
                void handleSubmit();
              }}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? 'Aplicando…' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
