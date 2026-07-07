import type { CartItem, CartTotals, FulfillmentMethod } from '@jdm/shared/cart';
import type { MyTicket } from '@jdm/shared/tickets';

import { cartCopy } from '../../copy/cart';

export type { FulfillmentMethod };

export function computeDisplayedCartTotals(
  totals: CartTotals,
  selectedFulfillmentMethod: FulfillmentMethod | null,
): CartTotals {
  if (selectedFulfillmentMethod !== 'pickup' || totals.shippingSubtotalCents === 0) {
    return totals;
  }
  return {
    ...totals,
    shippingSubtotalCents: 0,
    amountCents: totals.amountCents - totals.shippingSubtotalCents,
  };
}

export type FulfillmentSignals = {
  cartHasTicket: boolean;
  userOwnsValidFutureTicket: boolean;
};

export function computeDefaultFulfillmentMethod(
  methods: FulfillmentMethod[],
  signals: FulfillmentSignals,
): FulfillmentMethod | null {
  if (methods.length === 0) return null;
  const hasTicketSignal = signals.cartHasTicket || signals.userOwnsValidFutureTicket;
  if (methods.includes('pickup') && hasTicketSignal) return 'pickup';
  if (methods.includes('ship')) return 'ship';
  return methods[0] ?? null;
}

export type CartSection = {
  key: 'ticket' | 'product';
  title: string;
  data: CartItem[];
};

export function isProductItem(
  item: CartItem,
): item is CartItem & { kind: 'product'; product: NonNullable<CartItem['product']> } {
  return item.kind === 'product' && item.product !== null;
}

export function buildCartSections(items: CartItem[]): CartSection[] {
  const ticketItems = items.filter((item) => !isProductItem(item));
  const productItems = items.filter(isProductItem);
  const sections: CartSection[] = [];

  if (ticketItems.length > 0) {
    sections.push({ key: 'ticket', title: cartCopy.sections.tickets, data: ticketItems });
  }

  if (productItems.length > 0) {
    sections.push({ key: 'product', title: cartCopy.sections.products, data: productItems });
  }

  return sections;
}

export type PickupEventOption = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  hasOwnedTicket: boolean;
  hasCartTicket: boolean;
};

export function collectCartTicketEventIds(items: CartItem[]): string[] {
  return [
    ...new Set(
      items
        .filter((item) => !isProductItem(item))
        .flatMap((item) => (item.eventId ? [item.eventId] : [])),
    ),
  ];
}

export function buildPickupEventOptions(
  tickets: MyTicket[],
  cartEvents: Array<{ id: string; title: string; startsAt: string; endsAt: string }>,
): PickupEventOption[] {
  const options = new Map<string, PickupEventOption>();

  for (const ticket of tickets) {
    if (ticket.status !== 'valid') continue;
    if (ticket.event.status === 'cancelled') continue;
    options.set(ticket.event.id, {
      id: ticket.event.id,
      title: ticket.event.title,
      startsAt: ticket.event.startsAt,
      endsAt: ticket.event.endsAt,
      hasOwnedTicket: true,
      hasCartTicket: false,
    });
  }

  for (const event of cartEvents) {
    const existing = options.get(event.id);
    if (existing) {
      options.set(event.id, { ...existing, hasCartTicket: true });
      continue;
    }
    options.set(event.id, {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      hasOwnedTicket: false,
      hasCartTicket: true,
    });
  }

  return [...options.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function formatProductAttributes(
  attributes: Record<string, unknown> | null | undefined,
): string | null {
  if (!attributes) return null;

  const parts = Object.entries(attributes)
    .map(([key, value]) => {
      if (value === null || value === undefined) return null;
      if (Array.isArray(value)) {
        const formattedValues = value
          .filter((entry): entry is string | number | boolean =>
            ['string', 'number', 'boolean'].includes(typeof entry),
          )
          .map((entry) => String(entry));

        return formattedValues.length > 0 ? `${key}: ${formattedValues.join(', ')}` : null;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return `${key}: ${String(value)}`;
      }

      return null;
    })
    .filter((value): value is string => value !== null);

  return parts.length > 0 ? parts.join(' · ') : null;
}
