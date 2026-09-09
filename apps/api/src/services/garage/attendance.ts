import type { Prisma, PrismaClient } from '@prisma/client';

/** Either the root client or a transaction client — canon §3 (tx composition). */
export type AttendanceReadClient = PrismaClient | Prisma.TransactionClient;

/**
 * THE definition of an ATTENDED EVENT, in one place.
 *
 * An attended event is a PUBLISHED event that has ALREADY STARTED, for which
 * the member holds a checked-in (`used`) ticket. Attendance is counted in
 * EVENTS, never in check-ins: a member who brings a guest scans two tickets
 * at one event and that is still one attended event.
 *
 * Phase 1 has no `Checkin` model — attendance lives on `Ticket` via
 * `status === 'used'` + `usedAt`. Every consumer of "attended" derives it
 * from the two predicates below so the badge surface (EVT-002, EVT-003) and
 * the member-visible `GarageStats.events` counter can never drift apart.
 *
 * The started/published half matters because the check-in write applies NO
 * event predicate (`services/tickets/check-in.ts` flips `status: 'used'` on
 * ticket id + event id alone) and the staff event picker
 * (`routes/admin/check-in.ts` `GET /check-in/events`) lists published events
 * whose `endsAt` is still in the future — so a `used` ticket on a draft event
 * or on an event that has not started yet is reachable in production.
 */
export const startedPublishedEvent = (now: Date = new Date()): Prisma.EventWhereInput => ({
  status: 'published',
  startsAt: { lte: now },
});

/** The ticket half of "attended": this member checked in. */
export const attendedTicket = (userId: string): Prisma.TicketWhereInput => ({
  userId,
  status: 'used',
  usedAt: { not: null },
});

/**
 * Count the DISTINCT events this member has attended.
 *
 * Shape choice — `groupBy` on the TICKET side, not `event.count` with a
 * `tickets: { some: … }` filter. This runs on every check-in, so the plan
 * must not depend on how big the platform's event table has grown:
 *
 *   - `event.count({ where: { …startedPublishedEvent, tickets: { some } } })`
 *     drives off `Event`. Its only usable index is `@@index([status,
 *     startsAt])`, which matches EVERY past published event — a set that
 *     grows without bound — and then semi-joins each one to `Ticket`.
 *     Postgres MAY flip the semi-join and lead with `Ticket` instead, but
 *     that is a costing decision, not a guarantee.
 *   - This `groupBy` drives off `Ticket` with `userId` equality, which is the
 *     leading column of `@@index([userId, createdAt])`. We read only this
 *     member's rows and probe `Event` by primary key from there. Cost is
 *     bounded by ONE member's ticket history no matter how many events exist.
 *
 * `status` and `usedAt` are unindexed on `Ticket` (there is no
 * `Ticket.usedAt` index at all), but they are residual filters on rows the
 * userId seek already fetched, so they cost nothing extra.
 *
 * `groupBy` pushes the DISTINCT into SQL and returns one row per attended
 * event; `.length` is the count. We deliberately do NOT use Prisma's
 * `distinct` on `findMany`, which dedupes in memory instead.
 */
export const countAttendedEvents = async (
  client: AttendanceReadClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> => {
  const groups = await client.ticket.groupBy({
    by: ['eventId'],
    where: { ...attendedTicket(userId), event: startedPublishedEvent(now) },
  });
  return groups.length;
};
