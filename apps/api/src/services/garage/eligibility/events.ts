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
 *   - EVT-002 — "Sequência de 3"      : the user's three most-recently-used
 *                                       tickets cover the three most-recently-
 *                                       past published events of the user's
 *                                       ticket set (no missed event between
 *                                       check-ins). See streak query below.
 *   - EVT-003 — "Lenda da Pista"      : count(used tickets for user) >= 10
 *   - JDM-001 — "Curitibano de Coração" : the just-checked-in event has
 *                                       `city === 'Curitiba'` (case-insensitive).
 *   - JDM-002 — "Drift King"          : the just-checked-in event has
 *                                       `type === 'drift'`.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
  ticketId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  // Hydrate the triggering ticket + event so we can score JDM-001 / JDM-002
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

  // EVT-002 — streak of 3. Definition (per plan §18 §5239-5247): the user's
  // three most-recently-used tickets must cover the three most-recently-past
  // published events the user holds a ticket for. "No missed event" means
  // the last three events that already started have all been checked into.
  //
  // Concretely we compare two ordered lists of event ids:
  //   - lastUsed: the eventIds of the user's three most recent USED tickets,
  //     ordered by Ticket.usedAt DESC.
  //   - lastEligible: the eventIds of the user's three most recent
  //     published-and-already-started events they hold ANY ticket for,
  //     ordered by Event.startsAt DESC.
  //
  // Equality (in order) means streak. Anything else — missed event, fewer
  // than three eligible events, fewer than three check-ins — is no streak.
  if (usedCount >= 3) {
    const lastUsedTickets = await tx.ticket.findMany({
      where: { userId, status: 'used', usedAt: { not: null } },
      orderBy: { usedAt: 'desc' },
      take: 3,
      select: { eventId: true },
    });

    if (lastUsedTickets.length === 3) {
      const now = new Date();
      const lastEligibleEvents = await tx.event.findMany({
        where: {
          status: 'published',
          startsAt: { lte: now },
          tickets: { some: { userId } },
        },
        orderBy: { startsAt: 'desc' },
        take: 3,
        select: { id: true },
      });

      if (lastEligibleEvents.length === 3) {
        const usedIds = lastUsedTickets.map((t) => t.eventId);
        const eligibleIds = lastEligibleEvents.map((e) => e.id);
        const matches = usedIds.every((id, i) => id === eligibleIds[i]);
        if (matches) codes.push('EVT-002');
      }
    }
  }

  // JDM-001 — Curitiba check-in. Case-insensitive match against
  // `Event.city`. Trim() handles seed/admin-data whitespace drift.
  const city = trigger.event.city?.trim().toLowerCase() ?? null;
  if (city === 'curitiba') codes.push('JDM-001');

  // JDM-002 — drift-event check-in.
  if (trigger.event.type === 'drift') codes.push('JDM-002');

  return codes;
};
