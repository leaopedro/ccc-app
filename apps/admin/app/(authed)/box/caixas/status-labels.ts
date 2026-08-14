import type { BoxFulfillmentStatus, BoxStatus } from '@ccc/shared/box';

export const BOX_FULFILLMENT_LABEL: Record<BoxFulfillmentStatus, string> = {
  unfulfilled: 'A preparar',
  packed: 'Preparado',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export const BOX_FULFILLMENT_BADGE: Record<BoxFulfillmentStatus, string> = {
  unfulfilled: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  packed: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  shipped: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  delivered: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  cancelled: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
};

export const BOX_STATUS_LABEL: Record<BoxStatus, string> = {
  open: 'Em aberto',
  awaiting_payment: 'Aguardando pagamento',
  ready: 'Confirmada',
  skipped: 'Pulada',
  cancelled: 'Cancelada',
};

// Forward-only ship map. delivered/cancelled are terminal (no successor).
export const NEXT_FULFILLMENT: Record<
  BoxFulfillmentStatus,
  'packed' | 'shipped' | 'delivered' | null
> = {
  unfulfilled: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
  delivered: null,
  cancelled: null,
};

export const ADVANCE_LABEL: Record<'packed' | 'shipped' | 'delivered', string> = {
  packed: 'Marcar preparada',
  shipped: 'Marcar enviada',
  delivered: 'Marcar entregue',
};

// Counter display order (ready-box tally). cancelled shown last, only if > 0.
export const COUNTER_ORDER: BoxFulfillmentStatus[] = [
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
];
