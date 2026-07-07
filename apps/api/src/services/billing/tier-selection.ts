// apps/api/src/services/billing/tier-selection.ts
//
// Shared helper for premium-grant tier selection (canon §F8.7).
// Used by both F8.06 (ticket-backfill worker) and F8.07
// (event-publish-grant worker).
//
// Picks the FIRST TicketTier WHERE:
//   eventId = E
//   AND isPremiumGrantable = true
//   AND (salesCloseAt IS NULL OR salesCloseAt > `now`)
// Ordered by sortOrder ASC for deterministic pick.
//
// The optional `now` argument lets callers pin tier eligibility to a
// historical moment — e.g. the event-publish-grant worker pins `now` to
// the event's `publishedAt` so a job retried minutes later still picks
// the tier that was eligible at publish time. Defaults to the current
// wall-clock so existing callers (F8.06 backfill) remain unchanged.
//
// Returns null if no grantable tier exists. NEVER logs; NEVER inserts.
// Pure query helper. Callers own structured warnings on the null path.

import type { PrismaClient } from '@prisma/client';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export type GrantableTier = {
  id: string;
  eventId: string;
};

export const pickPremiumGrantableTier = async (
  client: Tx | PrismaClient,
  eventId: string,
  now: Date = new Date(),
): Promise<GrantableTier | null> => {
  const tier = await client.ticketTier.findFirst({
    where: {
      eventId,
      isPremiumGrantable: true,
      OR: [{ salesCloseAt: null }, { salesCloseAt: { gt: now } }],
    },
    select: { id: true, eventId: true },
    orderBy: { sortOrder: 'asc' },
  });
  return tier ?? null;
};
