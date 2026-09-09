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
// Ordered by (sortOrder ASC, id ASC) for a deterministic pick. `sortOrder`
// alone is NOT deterministic: it defaults to 0 and is not unique, so two
// grantable tiers on one event routinely tie.
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
    // `sortOrder` is `Int @default(0)` and carries no unique constraint, so an
    // event with two grantable tiers an admin never reordered has them BOTH at
    // 0 and `sortOrder` alone picks arbitrarily. That decides which tier's
    // `quantityTotal` the free ticket consumes and which tier's perks the
    // member gets. `id` makes it a total order.
    //
    // Scope of that guarantee: given the same eligible SET, every caller and
    // every retry now picks the same tier. It does NOT make the two callers
    // agree outright — F8.07 (publish-grant) passes the event's `publishedAt`
    // as `now` while F8.06 (backfill) passes wall-clock, so the
    // `salesCloseAt` predicate can admit different sets on the same event and
    // they can still land on different tiers. Closing that needs the callers
    // to agree on `now`, which is a separate decision.
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return tier ?? null;
};
