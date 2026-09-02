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
 * The extras an order paid for that hang off a ticket the order does NOT own,
 * each carrying the event it belongs to.
 *
 * The exclusion is the whole point, and it mirrors issuance exactly.
 * `issueTicketsForMixedOrder` (services/tickets/issue.ts) attaches extras two
 * different ways: for an event that HAS a ticket line in this order, onto the
 * tickets this order just created; for an event with no ticket line, onto the
 * buyer's pre-existing ticket. The first kind is already reached by
 * `revokeOwnedTickets` via `ticketId`. Only the second kind needs the
 * buyer-scoped resolver, and running it for the first kind too would reach
 * into a DIFFERENT, unrefunded order's ticket for the same event. So the scope
 * set is `extras event ids MINUS ticket event ids`, the same set difference
 * `issue.ts` builds with its `ticketEventIds`.
 *
 * Two shapes, because two writers exist. Cart checkout writes
 * `OrderItem(kind='extras')` rows, which carry their own `eventId` and are the
 * only safe source for a `mixed` order spanning several events. `POST /orders`
 * (routes/orders.ts, createPendingOrder) writes `OrderExtra` rows and no
 * `OrderItem` at all; those orders are single-event, so `Order.eventId` is the
 * event and the fallback is sound there and only there.
 *
 * The fallback is gated on the order having NO `OrderItem` rows, not on the
 * item scan coming back empty. Cart checkout writes BOTH `OrderItem` and
 * `OrderExtra` (services/cart/checkout.ts), so a mixed order whose every
 * extras line is paired with a ticket line legitimately yields zero scopes —
 * falling through to `OrderExtra` there would put the paired events straight
 * back in, which is the case the exclusion above exists to remove.
 */
const extrasScopesForOrder = async (
  db: Db,
  orderId: string,
  orderEventId: string | null,
): Promise<ExtrasScope[]> => {
  const items = await db.orderItem.findMany({
    where: { orderId, kind: { in: ['ticket', 'extras'] } },
    select: { kind: true, extraId: true, eventId: true, quantity: true },
  });

  if (items.length > 0) {
    const ticketEventIds = new Set(
      items.flatMap((it) => (it.kind === 'ticket' && it.eventId ? [it.eventId] : [])),
    );
    return items.flatMap((it) =>
      it.kind === 'extras' && it.extraId && it.eventId && !ticketEventIds.has(it.eventId)
        ? [{ eventId: it.eventId, extraId: it.extraId, quantity: it.quantity }]
        : [],
    );
  }

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
 *
 * KNOWN GAP, needs a schema change to close properly. The quantity cap can
 * still reach into the buyer's OTHER, unrefunded orders. `TicketExtraItem` is
 * `@@unique([ticketId, extraId])` and `upsertExtraItemsFromMeta` passes
 * `update: {}`, so quantity is not representable as rows: buying the same
 * extra twice yields ONE row. Alice buys 2 tickets each with a camiseta, then
 * an `extras_only` order for 2 more; issuance upserts onto the existing rows
 * and creates nothing, so refunding the extras order revokes the items her
 * EARLIER order paid for. Fixing it needs row-per-unit
 * (`TicketExtraItem.unitIndex`, the shape `PickupVoucher` already uses), which
 * is a migration, not a predicate. Do not "fix" it by widening the scope.
 *
 * `orderBy` carries `id` as a tiebreak on purpose. `createdAt` DEFAULTs to
 * `CURRENT_TIMESTAMP`, which in Postgres is TRANSACTION start time, so every
 * item written by one issuance shares an identical timestamp and `createdAt`
 * alone leaves the pick arbitrary whenever `take` is below the match count.
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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
      await revokeOwnedTickets(tx, orderId);
      // NOT gated on "revoked no tickets". A `mixed` order can hold a ticket
      // line for event A and a standalone extras line for event B at once;
      // `issueTicketsForMixedOrder` hangs the B extras on the buyer's
      // pre-existing B ticket. Gating on an empty ticket list meant the A
      // tickets made the list non-empty, the resolver never ran, and the
      // customer kept the B goods after a full refund. `extrasScopesForOrder`
      // already excludes A, so this cannot double-revoke what
      // `revokeOwnedTickets` just handled.
      if (order.kind === 'mixed') {
        await revokeExtrasOnlyItems(tx, orderId);
      }
    }

    await tx.pickupVoucher.updateMany({
      where: { orderId, status: 'valid' },
      data: { status: 'revoked' },
    });
  });
};
