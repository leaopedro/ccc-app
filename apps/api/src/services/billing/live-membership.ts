// apps/api/src/services/billing/live-membership.ts
//
// One definition of "the live PremiumMembership of this garage".
//
// A garage can legally hold more than one live row. The partial unique index
// only covers three of the five LIVE_MEMBERSHIP_STATUSES:
//
//   CREATE UNIQUE INDEX premium_membership_live_per_garage
//     ON "PremiumMembership" ("garageId")
//     WHERE status IN ('active', 'past_due', 'cancel_scheduled');
//
// so a `trialing` or `paused` row can sit beside the row that is actually
// billing, and the activation path treats that as an expected outcome rather
// than a crash. A `findFirst` over the wide list with no `orderBy` leaves the
// choice to the planner, and the planner owes us nothing.
//
// Measured on this schema it was not even a coin flip: the read came back from
// an Index Scan on (garageId, status), so rows arrived in enum declaration
// order (trialing, active, past_due, cancel_scheduled, expired, paused) and a
// `trialing` sibling shadowed the `active` row in both insert orders. Nothing
// pins that plan, though — different statistics or a Postgres upgrade can pick
// another one and hand back another row. So the bug is the absent ordering,
// not the particular row that won: a member taps Cancelar, Stripe cancels a
// subscription nobody chose, and the one charging them every month survives
// untouched.
//
// The rule below does not lean on that measurement either. Step 1 is bounded
// to a single row by the partial unique index and still carries an explicit
// `orderBy`; step 2 has a total order through `id`. Both hold under any plan.
//
// Selection rule, in order:
//
//   1. Prefer a row whose status is inside LIVE_PER_GARAGE_INDEX_STATUSES.
//      That is the row holding the garage's live slot — the one the provider
//      is billing, and the one an action must act on. The index guarantees at
//      most one such row exists, so this step alone decides the pick whenever
//      the garage has one.
//   2. Otherwise fall back to the wide list (a garage whose only live rows are
//      `trialing`/`paused`), newest first by createdAt then id. Same ordering
//      the status read already used, so no existing single-row behaviour moves.
//
// Every caller uses this helper — the status screen included — so the row the
// app shows the member and the row an action mutates are the same row by
// construction. Cancelling what the screen just described is the whole point.

import { LIVE_MEMBERSHIP_STATUSES, LIVE_PER_GARAGE_INDEX_STATUSES } from '@ccc/shared/premium';
import type { PremiumMembership, PrismaClient } from '@prisma/client';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * The garage's live membership, or null when it has none. Pass the transaction
 * client when called inside one, so the read sees the same snapshot (and the
 * same `SELECT ... FOR UPDATE` lock) as the rest of the transaction.
 */
export const pickLiveMembership = async (
  client: Tx | PrismaClient,
  garageId: string,
): Promise<PremiumMembership | null> => {
  const slotHolder = await client.premiumMembership.findFirst({
    where: { garageId, status: { in: [...LIVE_PER_GARAGE_INDEX_STATUSES] } },
    // The index allows only one row here. The ordering is belt and braces:
    // if the index is ever widened or dropped, this still picks one row the
    // same way the fallback below does, instead of silently going random.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (slotHolder) return slotHolder;

  return client.premiumMembership.findFirst({
    where: { garageId, status: { in: [...LIVE_MEMBERSHIP_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};
