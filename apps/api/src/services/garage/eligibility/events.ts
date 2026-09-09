import type { Prisma } from '@prisma/client';

import { attendedTicket, countAttendedEvents, startedPublishedEvent } from '../attendance.js';

export type BadgeCode = string;

/**
 * Compute the event-surface badges a user is eligible for AFTER `ticket.id`
 * has just transitioned to `status: 'used'` (check-in). The caller must run
 * this inside the same transaction as the check-in update so the badge grant
 * is atomic with the attendance.
 *
 * Phase 1 has no dedicated `Checkin` model — attendance lives on `Ticket`
 * via `status === 'used'` + `usedAt`. The "attended event" set is defined
 * once in `../attendance.ts` and shared with the member-visible
 * `GarageStats.events` counter; nothing here restates it.
 *
 * Codes:
 *   - EVT-001 — "Primeiro Check-in"   : the user has at least one used ticket
 *                                       (see the note at the check below —
 *                                       this one is deliberately NOT
 *                                       event-based).
 *   - EVT-002 — "Sequência de 3"      : the user attended each of the three
 *                                       most-recently-past published events of
 *                                       the user's ticket set (no missed
 *                                       event). See streak query below.
 *   - EVT-003 — "Veterano de Pista"   : count(DISTINCT attended events) >= 10
 *   - CCC-001 — "Curitibano de Coração" : the just-checked-in event has
 *                                       `city === 'Curitiba'` (case-insensitive).
 *   - CCC-002 — "Drift King"          : the just-checked-in event has
 *                                       `type === 'drift'`.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
  ticketId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  // Hydrate the triggering ticket + event so we can score CCC-001 / CCC-002
  // without a second round-trip. The ticket must already be `used` here —
  // the caller has just flipped status — but we don't filter by status so a
  // stale call still yields the JDM-* codes (those are based on event
  // attributes, not the check-in count).
  const trigger = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      eventId: true,
      event: { select: { city: true, type: true } },
    },
  });
  if (!trigger) return codes;

  const now = new Date();

  // EVT-001 — "has checked in at least once". Deliberately NOT event-based,
  // and deliberately an existence probe rather than a count.
  //
  // Counting DISTINCT events instead of tickets cannot change a `>= 1` test:
  // zero used tickets is zero attended events, and one or more used tickets is
  // at least one event holding a used ticket. The guest-inflation bug that
  // motivated the events-not-check-ins correction is unreachable at this
  // threshold, so switching the unit here would be a no-op.
  //
  // What WOULD change is the started/published gate that `attendance.ts`
  // applies, and that gate is wrong for this badge. Staff can select a
  // published event before it starts (`GET /check-in/events` has no upper
  // `startsAt` bound) and scan at an early gate; under an event-based rule the
  // member's actual first check-in would award nothing, and "Primeira
  // Largada" would fire on some unrelated later scan or never. An event later
  // reverted to `draft` or `cancelled` would also retroactively un-earn it.
  // So EVT-001 stays a ticket-existence test.
  //
  // A full `count` was never needed for a `>= 1` question — `findFirst` lets
  // Postgres stop at the first matching row.
  const anyUsedTicket = await tx.ticket.findFirst({
    where: { userId, status: 'used' },
    select: { id: true },
  });
  if (anyUsedTicket) codes.push('EVT-001');

  // EVT-003 — ten DISTINCT attended events, not ten check-ins. Five events
  // attended with a guest each time is ten used tickets and must NOT earn
  // this. See `countAttendedEvents` for the query-shape rationale (this runs
  // on every check-in).
  const attendedEventCount = await countAttendedEvents(tx, userId, now);
  if (attendedEventCount >= 10) codes.push('EVT-003');

  // EVT-002 — streak of 3. Definition (per plan §18 §5239-5247): the three
  // most-recently-past published events the user holds a ticket for must ALL
  // have been checked into. "No missed event" is a statement about EVENTS, not
  // about tickets: a member who brings a guest checks in two tickets for one
  // event and that is still a single attended event.
  //
  // So we compare two ordered lists of EVENT ids, both drawn from the Event
  // table so each event appears exactly once no matter how many tickets the
  // member holds for it:
  //   - attended: the three most recent already-started published events the
  //     user has a USED ticket for.
  //   - eligible: the three most recent already-started published events the
  //     user holds ANY ticket for.
  //
  // `attended` is a subset of `eligible`, so equality in order means every one
  // of the three most recent eligible events was attended. Anything else —
  // missed event, fewer than three eligible events, fewer than three attended
  // events — is no streak.
  //
  // Both orders end in `Event.id` so the sort is total. `startsAt` is not
  // unique (two events can start at the same instant) and neither is
  // `Ticket.usedAt`; without the tiebreak the two lists could order a tie
  // differently and deny an earned badge at random. Ordering by the event's
  // own columns also keeps check-in timestamps out of the comparison entirely.
  //
  // The fetch is bounded to 3 rows per query. Note we deliberately do NOT use
  // Prisma's `distinct` over tickets: with `distinct` set, Prisma drops the
  // SQL LIMIT and dedupes in memory, which would read the member's whole
  // ticket history on every check-in.
  const startedPublished = startedPublishedEvent(now);

  const attendedEvents = await tx.event.findMany({
    where: {
      ...startedPublished,
      tickets: { some: attendedTicket(userId) },
    },
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: 3,
    select: { id: true },
  });

  // Fewer than three DISTINCT attended events can never be a streak of three.
  // This is the real gate: a used-ticket count is not, since five used tickets
  // can cover two events.
  if (attendedEvents.length === 3) {
    const eligibleEvents = await tx.event.findMany({
      where: {
        ...startedPublished,
        tickets: { some: { userId } },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: { id: true },
    });

    // eligibleEvents cannot be shorter than 3 here: `attended` filters the same
    // events by a strictly narrower ticket predicate, so the eligible set is a
    // superset of the attended one. The length check is still written out rather
    // than left to that argument, because `every` on a short array passes
    // VACUOUSLY — if the invariant ever broke, the badge would be granted to
    // everyone instead of failing visibly.
    const attendedIds = attendedEvents.map((e) => e.id);
    const matches =
      eligibleEvents.length === 3 && eligibleEvents.every((e, i) => e.id === attendedIds[i]);
    if (matches) codes.push('EVT-002');
  }

  // CCC-001 — Curitiba check-in. Case-insensitive match against
  // `Event.city`. Trim() handles seed/admin-data whitespace drift.
  const city = trigger.event.city?.trim().toLowerCase() ?? null;
  if (city === 'curitiba') codes.push('CCC-001');

  // CCC-002 — drift-event check-in.
  if (trigger.event.type === 'drift') codes.push('CCC-002');

  return codes;
};
