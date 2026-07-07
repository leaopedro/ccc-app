import type { StoreFulfillmentStatus } from '@jdm/shared/store';

export const FULFILLMENT_STATUS_LABEL: Record<StoreFulfillmentStatus, string> = {
  unfulfilled: 'Aguardando preparo',
  packed: 'Embalado',
  shipped: 'Enviado',
  delivered: 'Entregue',
  pickup_ready: 'Pronto p/ retirada',
  picked_up: 'Retirado',
  cancelled: 'Cancelado',
};

export const FULFILLMENT_STATUS_BADGE: Record<StoreFulfillmentStatus, string> = {
  unfulfilled: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  packed: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  shipped: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  delivered: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  pickup_ready: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  picked_up: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  cancelled: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Reembolsado',
  expired: 'Expirado',
};

export const FULFILLMENT_METHOD_LABEL = {
  ship: 'Envio',
  pickup: 'Retirada',
} as const;

export const QUEUE_FILTER_LABEL = {
  all: 'Todos',
  open: 'Em aberto',
  unfulfilled: 'Aguardando',
  packed: 'Embalados',
  shipped: 'Enviados',
  delivered: 'Entregues',
  pickup_ready: 'Pronto p/ retirada',
  picked_up: 'Retirados',
  cancelled: 'Cancelados',
} as const;
