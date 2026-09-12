import type { Prisma } from '@prisma/client';

import { releaseAllReservationsForOrders } from './expire.js';

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

/**
 * Cancel the member's own live pending ticket order so their retry can proceed.
 *
 * JDMA-485 added `findPendingTicketOrderForEvent` so nobody could hold two live
 * reservations for one event. Refusing the retry outright also punished the
 * member for the ordinary case: an abandoned PaymentSheet leaves a `pending`
 * order behind, and every later attempt for that event was refused until it
 * expired — 15 minutes on the native flow, and never when `expiresAt` is null.
 *
 * The invariant survives because this runs INSIDE the checkout transaction and
 * before the new reservation is taken: the old order is cancelled and its seats
 * released first, so the tier is never double-counted.
 *
 * Returns null when the row was no longer `pending` — a concurrent webhook
 * settled it between the find and this update. That is the one case where the
 * caller must still refuse, because the member now genuinely holds a ticket.
 *
 * `providerRef` comes back so the caller can cancel the abandoned
 * PaymentIntent. Two live intents for one ticket is exactly the failure mode
 * that makes superseding dangerous, and the cart route already cancels every
 * ref it is handed.
 */
export async function supersedePendingTicketOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<{ providerRefs: string[] } | null> {
  // Status-guarded claim, same shape as sweepExpiredOrdersForTier: only the
  // caller that actually flips the row may release its reservations, or a
  // concurrent expiry would decrement `quantitySold` twice.
  const flipped = await tx.order.updateMany({
    where: { id: orderId, status: 'pending' },
    data: { status: 'cancelled', fulfillmentStatus: 'cancelled' },
  });
  if (flipped.count === 0) return null;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { providerRef: true },
  });

  await releaseAllReservationsForOrders(tx, [orderId]);

  return { providerRefs: order?.providerRef ? [order.providerRef] : [] };
}
