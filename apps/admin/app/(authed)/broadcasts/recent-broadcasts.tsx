'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { BroadcastSummary } from '../../../../../packages/shared/src/broadcasts';

import { cancelBroadcastAction } from '~/lib/broadcast-actions';

type EventOption = {
  id: string;
  title: string;
  startsAt: string;
};

type ProductOption = {
  id: string;
  title: string;
  slug: string;
};

const statusLabel: Record<BroadcastSummary['status'], string> = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  processing: 'Processando',
  sent: 'Enviado',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

const statusClass: Record<BroadcastSummary['status'], string> = {
  draft: 'border-[color:var(--color-border)] text-[color:var(--color-muted)]',
  scheduled: 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]',
  processing: 'border-yellow-600 text-yellow-400',
  sent: 'border-green-700 text-green-400',
  failed: 'border-red-700 text-red-400',
  cancelled: 'border-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

const renderTarget = (broadcast: BroadcastSummary, events: EventOption[]) => {
  if (broadcast.targetKind === 'all') return 'Toda a base';
  if (broadcast.targetKind === 'premium') return 'Somente premium';
  if (broadcast.targetKind === 'city') return broadcast.targetValue ?? 'Cidade';
  return events.find((event) => event.id === broadcast.targetValue)?.title ?? 'Evento selecionado';
};

const renderDeliveryMode = (broadcast: BroadcastSummary) =>
  broadcast.deliveryMode === 'in_app_only' ? 'Somente na central' : 'Central + push';

const renderDestination = (
  broadcast: BroadcastSummary,
  events: EventOption[],
  products: ProductOption[],
) => {
  const destination = broadcast.destination;
  if (!destination || destination.kind === 'none') return 'Sem link adicional';
  if (destination.kind === 'tickets') return 'Meus ingressos';
  if (destination.kind === 'event') {
    return events.find((event) => event.id === destination.eventId)?.title ?? 'Evento selecionado';
  }
  if (destination.kind === 'product') {
    return (
      products.find((product) => product.id === destination.productId)?.title ??
      'Produto selecionado'
    );
  }
  if (destination.kind === 'internal_path') return destination.path;
  return destination.url;
};

const canCancel = (status: BroadcastSummary['status']) =>
  status === 'draft' || status === 'scheduled' || status === 'failed';

export function RecentBroadcasts({
  broadcasts,
  events,
  products,
}: {
  broadcasts: BroadcastSummary[];
  events: EventOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [errorById, setErrorById] = useState<Record<string, string | null>>({});
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleCancel = (id: string) => {
    startTransition(async () => {
      setCancelingId(id);
      const result = await cancelBroadcastAction(id);
      if (result.error) {
        setErrorById((current) => ({ ...current, [id]: result.error }));
        setCancelingId(null);
        return;
      }
      setErrorById((current) => ({ ...current, [id]: null }));
      setCancelingId(null);
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-[color:var(--color-border)] p-5">
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Recentes</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Últimos 50 broadcasts com status, alvo e entregas resumidas.
        </p>
      </div>

      {broadcasts.length === 0 ? (
        <p className="rounded-lg border border-[color:var(--color-border)] p-4 text-sm text-[color:var(--color-muted)]">
          Nenhum broadcast criado ainda.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {broadcasts.map((broadcast) => (
            <article
              key={broadcast.id}
              className="rounded-lg border border-[color:var(--color-border)] p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{broadcast.title}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass[broadcast.status]}`}
                    >
                      {statusLabel[broadcast.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--color-muted)]">{broadcast.body}</p>
                </div>

                {canCancel(broadcast.status) ? (
                  <button
                    type="button"
                    onClick={() => handleCancel(broadcast.id)}
                    disabled={cancelingId === broadcast.id}
                    className="rounded border border-red-700 px-3 py-2 text-sm text-red-400 disabled:opacity-60"
                  >
                    {cancelingId === broadcast.id ? 'Cancelando...' : 'Cancelar'}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                    Público
                  </p>
                  <p className="mt-1">{renderTarget(broadcast, events)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                    Entrega
                  </p>
                  <p className="mt-1">{renderDeliveryMode(broadcast)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                    Destino
                  </p>
                  <p className="mt-1 break-all">{renderDestination(broadcast, events, products)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                    Agendado para
                  </p>
                  <p className="mt-1">{fmtDateTime(broadcast.scheduledAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                    Entregas
                  </p>
                  <p className="mt-1">
                    {broadcast.sentCount} enviadas • {broadcast.failedCount} falhas
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                    Pendentes
                  </p>
                  <p className="mt-1">{broadcast.pendingCount}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-[color:var(--color-muted)]">
                <span>Criado em {fmtDateTime(broadcast.createdAt)}</span>
                <span>Iniciado em {fmtDateTime(broadcast.startedAt)}</span>
                <span>Concluído em {fmtDateTime(broadcast.completedAt)}</span>
              </div>

              {errorById[broadcast.id] ? (
                <p className="mt-3 text-sm text-red-400">{errorById[broadcast.id]}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
