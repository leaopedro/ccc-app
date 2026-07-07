import type { MyOrder } from '@jdm/shared/orders';

import { ordersCopy } from '../../copy/orders';

/**
 * Derives the human-readable order-kind label from item-content flags.
 *
 * `order.kind` is a settlement invariant (multi-item carts get `mixed`
 * regardless of item types), so it must NOT be used for display.
 * `containsTickets` / `containsStoreItems` reflect actual content.
 *
 * ticket + extras (no store items) → "Evento", because extras are add-ons
 * to a ticket order, not store products.
 */
export function resolveOrderKindLabel(
  containsTickets: boolean,
  containsStoreItems: boolean,
  kind: MyOrder['kind'],
): string {
  const copy = ordersCopy.orderKind;
  if (containsTickets && containsStoreItems) return copy.mixed;
  if (containsTickets) return copy.ticket;
  if (containsStoreItems) return copy.product;
  return copy[kind];
}
