import type { MyTicket } from '@jdm/shared/tickets';

export type TicketStatusFilter = 'all' | 'valid' | 'used' | 'expired';

export const TICKET_STATUS_FILTERS: TicketStatusFilter[] = ['all', 'valid', 'used', 'expired'];

export function isExpired(ticket: MyTicket): boolean {
  return (
    ticket.status === 'revoked' ||
    (ticket.status === 'valid' && new Date(ticket.event.endsAt) < new Date())
  );
}

export function applyStatusFilter(items: MyTicket[], filter: TicketStatusFilter): MyTicket[] {
  switch (filter) {
    case 'valid':
      return items.filter((t) => t.status === 'valid' && !isExpired(t));
    case 'used':
      return items.filter((t) => t.status === 'used');
    case 'expired':
      return items.filter(isExpired);
    default:
      return items;
  }
}

export function applyEventFilter(items: MyTicket[], eventId: string | null): MyTicket[] {
  if (!eventId) return items;
  return items.filter((t) => t.event.id === eventId);
}

export function findEventTitle(items: MyTicket[], eventId: string | null): string | null {
  if (!eventId) return null;
  return items.find((t) => t.event.id === eventId)?.event.title ?? null;
}
