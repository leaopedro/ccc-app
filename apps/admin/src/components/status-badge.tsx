import type { EventStatus } from '@jdm/shared/events';

const COPY: Record<EventStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  cancelled: 'Cancelado',
};

const TONE: Record<EventStatus, string> = {
  draft: 'bg-neutral-700 text-neutral-100',
  published: 'bg-emerald-700 text-emerald-50',
  cancelled: 'bg-red-800 text-red-50',
};

export const StatusBadge = ({ status }: { status: EventStatus }) => (
  <span className={`rounded px-2 py-0.5 text-xs ${TONE[status]}`}>{COPY[status]}</span>
);
