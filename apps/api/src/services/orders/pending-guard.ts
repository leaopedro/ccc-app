import type { Prisma } from '@prisma/client';

export class PendingTicketOrderForEventError extends Error {
  readonly code = 'PENDING_TICKET_ORDER_FOR_EVENT' as const;
  constructor(
    public readonly userId: string,
    public readonly eventId: string,
    public readonly orderId: string,
  ) {
    super(`user ${userId} has pending order ${orderId} for event ${eventId}`);
    this.name = 'PendingTicketOrderForEventError';
  }
}

// Returns a live pending order that already reserves a ticket for this user/event,
// or null if none. Live = status='pending' AND (expiresAt is null OR expiresAt > now).
// Matches: kind='ticket' with the same eventId, or kind='mixed' with a ticket OrderItem
// for that event. extras_only orders are excluded because they don't issue a new ticket.
export async function findPendingTicketOrderForEvent(
  tx: Prisma.TransactionClient,
  userId: string,
  eventId: string,
): Promise<{ id: string } | null> {
  const now = new Date();
  return tx.order.findFirst({
    where: {
      userId,
      status: 'pending',
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        {
          OR: [
            { kind: 'ticket', eventId },
            { kind: 'mixed', items: { some: { kind: 'ticket', eventId } } },
          ],
        },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
}
