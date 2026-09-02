import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** A `PrismaClient` satisfies this too, so the impact read can reuse the resolver. */
type Db = Pick<Tx, 'order' | 'orderItem' | 'orderExtra' | 'ticketExtraItem'>;

const revokeOwnedTickets = async (tx: Tx, orderId: string): Promise<string[]> => {
  const tickets = await tx.ticket.findMany({
    where: { orderId, status: 'valid' },
    select: { id: true },
  });
  if (tickets.length === 0) return [];

  const ticketIds = tickets.map((t) => t.id);

  await tx.ticket.updateMany({
    where: { id: { in: ticketIds }, status: 'valid' },
    data: { status: 'revoked' },
  });

  await tx.ticketExtraItem.updateMany({
    where: { ticketId: { in: ticketIds }, status: 'valid' },
    data: { status: 'revoked' },
  });

  return ticketIds;
};

/** One extras purchase: which extra, at which event, how many units. */
type ExtrasScope = { eventId: string; extraId: string; quantity: number };

/**
 * The extras an order paid for, each carrying the event it belongs to.
 *
 * Two shapes, because two writers exist. Cart checkout writes
 * `OrderItem(kind='extras')` rows, which carry their own `eventId` and are the
 * only safe source for a `mixed` order spanning several events. `POST /orders`
 * (routes/orders.ts, createPendingOrder) writes `OrderExtra` rows and no
 * `OrderItem` at all; those orders are single-event, so `Order.eventId` is the
 * event and the fallback is sound there and only there.
 */
const extrasScopesForOrder = async (
  db: Db,
  orderId: string,
  orderEventId: string | null,
): Promise<ExtrasScope[]> => {
  const items = await db.orderItem.findMany({
    where: { orderId, kind: 'extras' },
    select: { extraId: true, eventId: true, quantity: true },
  });
  const fromItems = items.flatMap((it) =>
    it.extraId && it.eventId
      ? [{ eventId: it.eventId, extraId: it.extraId, quantity: it.quantity }]
      : [],
  );
  if (fromItems.length > 0) return fromItems;

  if (!orderEventId) return [];
  const orderExtras = await db.orderExtra.findMany({
    where: { orderId },
    select: { extraId: true, quantity: true },
  });
  return orderExtras.map((oe) => ({
    eventId: orderEventId,
    extraId: oe.extraId,
    quantity: oe.quantity,
  }));
};

/**
 * The `TicketExtraItem` rows a refund of `orderId` may revoke when the order
 * owns no `Ticket` of its own — an `extras_only` order, or the standalone
 * extras lines of a `mixed` one.
 *
 * Load-bearing scope, and the reason this function exists instead of an
 * `extraId in (...)` predicate. `TicketExtra` hangs off `eventId`
 * (schema.prisma: `TicketExtra.eventId`) and is SHARED by every attendee of
 * that event; `TicketExtraItem` is per-TICKET and unique on
 * `[ticketId, extraId]`. Matching on `extraId` alone therefore matches every
 * buyer of that extra at that event: refunding one attendee's camiseta
 * revoked the camiseta of all forty, silently.
 *
 * The real ownership chain is the one `issueExtrasOnly` writes
 * (services/tickets/issue.ts): an extras order creates no ticket, it attaches
 * its items to the BUYER's already-valid ticket for that event. So the owner
 * is `(order.userId, scope.eventId)`, not the order, and the scope has to be
 * `ticket.userId` + `ticket.eventId` + `extraId`, capped at the quantity paid
 * for.
 */
export const resolveOrderExtraItemIds = async (db: Db, orderId: string): Promise<string[]> => {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { userId: true, eventId: true },
  });
  if (!order) return [];

  const scopes = await extrasScopesForOrder(db, orderId, order.eventId);
  if (scopes.length === 0) return [];

  const ids: string[] = [];
  for (const scope of scopes) {
    const items = await db.ticketExtraItem.findMany({
      where: {
        extraId: scope.extraId,
        status: 'valid',
        ticket: { userId: order.userId, eventId: scope.eventId },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.max(scope.quantity, 0),
    });
    ids.push(...items.map((i) => i.id));
  }
  return ids;
};

const revokeExtrasOnlyItems = async (tx: Tx, orderId: string): Promise<void> => {
  const itemIds = await resolveOrderExtraItemIds(tx, orderId);
  if (itemIds.length === 0) return;

  await tx.ticketExtraItem.updateMany({
    where: { id: { in: itemIds }, status: 'valid' },
    data: { status: 'revoked' },
  });
};

export const revokeTicketsForRefundedOrder = async (orderId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { kind: true },
    });
    if (!order) return;

    if (order.kind === 'extras_only') {
      await revokeExtrasOnlyItems(tx, orderId);
    } else {
      const revokedTicketIds = await revokeOwnedTickets(tx, orderId);
      if (order.kind === 'mixed' && revokedTicketIds.length === 0) {
        await revokeExtrasOnlyItems(tx, orderId);
      }
    }

    await tx.pickupVoucher.updateMany({
      where: { orderId, status: 'valid' },
      data: { status: 'revoked' },
    });
  });
};
