'use client';

import type { AdminEventRow } from '@jdm/shared/admin';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type MutableRefObject,
} from 'react';

import {
  grantTicketAction,
  loadEventDetailAction,
  type EventDetailForGrant,
} from '~/lib/grant-actions';

type Props = {
  userId: string;
  events: AdminEventRow[];
};

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

export function GrantTicketModal({ userId, events }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [showEventSuggestions, setShowEventSuggestions] = useState(false);
  const [eventDetail, setEventDetail] = useState<EventDetailForGrant | null>(null);
  const [selectedTierId, setSelectedTierId] = useState('');
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [licensePlate, setLicensePlate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTier = eventDetail?.tiers.find((t) => t.id === selectedTierId);

  const visibleEvents = eventQuery.trim()
    ? events.filter((ev) => ev.title.toLowerCase().includes(eventQuery.trim().toLowerCase()))
    : events;

  const resetForm = useCallback(() => {
    setSelectedEventId('');
    setEventQuery('');
    setShowEventSuggestions(false);
    setEventDetail(null);
    setSelectedTierId('');
    setSelectedExtras([]);
    setLicensePlate('');
    setNote('');
    setError(null);
    setSuccess(false);
  }, []);

  const close = useCallback(() => {
    clearTimer(closeTimerRef);
    setOpen(false);
    resetForm();
  }, [resetForm]);

  const selectEvent = (eventId: string, eventTitle: string) => {
    setSelectedEventId(eventId);
    setEventQuery(eventTitle);
    setShowEventSuggestions(false);
    setEventDetail(null);
    setSelectedTierId('');
    setSelectedExtras([]);

    startTransition(async () => {
      const detail = await loadEventDetailAction(eventId);
      setSelectedEventId((current) => {
        if (current === eventId) {
          setEventDetail(detail);
          if (detail.tiers.length === 1) setSelectedTierId(detail.tiers[0]?.id ?? '');
        }
        return current;
      });
    });
  };

  const handleEventQueryChange = (value: string) => {
    setEventQuery(value);
    setShowEventSuggestions(true);

    const exactMatch = events.find((ev) => ev.title.toLowerCase() === value.trim().toLowerCase());
    if (!exactMatch) {
      setSelectedEventId('');
      setEventDetail(null);
      setSelectedTierId('');
      setSelectedExtras([]);
    }
  };

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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !selectedTierId) return;
    startTransition(async () => {
      setError(null);
      const result = await grantTicketAction(userId, {
        eventId: selectedEventId,
        tierId: selectedTierId,
        extras: selectedExtras,
        ...(licensePlate.trim() ? { licensePlate: licensePlate.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });

      if (result.ok) {
        setSuccess(true);
        showToast('success', 'Ingresso atribuído com sucesso!');
        router.refresh();
        closeTimerRef.current = setTimeout(() => close(), 1200);
      } else {
        setError(result.error);
        showToast('error', result.error);
      }
    });
  };

  const toggleExtra = (id: string, checked: boolean) => {
    setSelectedExtras((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  if (!open) {
    return (
      <>
        {toast ? (
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
        ) : null}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold"
        >
          Atribuir ingresso
        </button>
      </>
    );
  }

  return (
    <>
      {toast ? (
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
      ) : null}

      <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="grant-modal-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="grant-modal-title" className="mb-4 text-lg font-semibold">
          Atribuir ingresso
        </h2>

        {success ? (
          <p className="rounded border border-green-500/40 bg-green-500/10 p-3 text-sm">
            Ingresso atribuído com sucesso!
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[color:var(--color-muted)]">Evento</span>
              <input
                type="text"
                value={eventQuery}
                onChange={(e) => handleEventQueryChange(e.target.value)}
                onFocus={() => setShowEventSuggestions(true)}
                onBlur={() => setTimeout(() => setShowEventSuggestions(false), 100)}
                placeholder="Buscar evento..."
                autoComplete="off"
                required
                className={inputCls}
              />
              {showEventSuggestions ? (
                <div className="max-h-40 overflow-y-auto rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]">
                  {visibleEvents.length > 0 ? (
                    visibleEvents.slice(0, 12).map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectEvent(ev.id, ev.title)}
                        className="block w-full border-b border-[color:var(--color-border)] px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-[color:var(--color-border)]/40"
                      >
                        {ev.title}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-1.5 text-xs text-[color:var(--color-muted)]">
                      Nenhum evento encontrado.
                    </p>
                  )}
                </div>
              ) : null}
            </label>

            {isPending && !eventDetail ? (
              <p className="text-xs text-[color:var(--color-muted)]">Carregando categorias...</p>
            ) : null}

            {eventDetail ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[color:var(--color-muted)]">Categoria</span>
                <select
                  value={selectedTierId}
                  onChange={(e) => setSelectedTierId(e.target.value)}
                  required
                  className={inputCls}
                >
                  <option value="">Selecionar categoria...</option>
                  {eventDetail.tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {eventDetail && eventDetail.extras.length > 0 ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-xs text-[color:var(--color-muted)]">Extras</legend>
                {eventDetail.extras.map((ex) => (
                  <label key={ex.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedExtras.includes(ex.id)}
                      onChange={(e) => toggleExtra(ex.id, e.target.checked)}
                    />
                    {ex.name}
                  </label>
                ))}
              </fieldset>
            ) : null}

            {selectedTier?.requiresCar ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[color:var(--color-muted)]">
                  Placa do carro (opcional)
                </span>
                <input
                  type="text"
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                  maxLength={20}
                  placeholder="ABC-1234"
                  className={inputCls}
                />
              </label>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="text-xs text-[color:var(--color-muted)]">Observação (opcional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                className={inputCls}
              />
            </label>

            {error ? (
              <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm">{error}</p>
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
                disabled={isPending || !selectedEventId || !selectedTierId}
                className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {isPending ? '...' : 'Confirmar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
