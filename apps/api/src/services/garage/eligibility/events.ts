import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Compute the event-surface badges a user is eligible for AFTER `ticket.id`
 * has just transitioned to `status: 'used'` (check-in). The caller must run
 * this inside the same transaction as the check-in update so the badge grant
 * is atomic with the attendance.
 *
 * Phase 1 has no dedicated `Checkin` model — attendance lives on `Ticket`
 * via `status === 'used'` + `usedAt`. Every query in this file derives the
 * "check-ins" set from used tickets joined to their event.
 *
 * Codes:
 *   - EVT-001 — "Primeiro Check-in"   : count(used tickets for user) >= 1
 *   - EVT-002 — "Sequência de 3"      : the user attended each of the three
 *                                       most-recently-past published events of
 *                                       the user's ticket set (no missed
 *                                       event). See streak query below.
 *   - EVT-003 — "Lenda da Pista"      : count(used tickets for user) >= 10
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

  // EVT-001 / EVT-003 — raw used-ticket count.
  const usedCount = await tx.ticket.count({
    where: { userId, status: 'used' },
  });
  if (usedCount >= 1) codes.push('EVT-001');
  if (usedCount >= 10) codes.push('EVT-003');

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
  const now = new Date();
  const startedPublished = {
    status: 'published',
    startsAt: { lte: now },
  } as const;

  const attendedEvents = await tx.event.findMany({
    where: {
      ...startedPublished,
      tickets: { some: { userId, status: 'used', usedAt: { not: null } } },
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

    // eligibleEvents has exactly 3 rows here: every attended event is also an
    // eligible one, so the superset cannot be shorter.
    const attendedIds = attendedEvents.map((e) => e.id);
    const matches = eligibleEvents.every((e, i) => e.id === attendedIds[i]);
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
