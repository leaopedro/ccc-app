import type { BadgeRarity, Prisma, XpReason } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

import { readGamificationEnabled } from './killswitch.js';

/**
 * Result of an `awardXp` attempt. The boolean carries the side-effect signal;
 * the optional `reason` documents why no row landed when `awarded` is `false`.
 *
 *   - `gamification_disabled` — killswitch is off; awarder is a no-op (canon §5).
 *   - `duplicate`             — `@@unique([garageId, reason, sourceRef])` (P2002)
 *                               fired; idempotent re-attempt silently swallowed
 *                               (§C1).
 *
 * Any other error rethrows so the parent transaction rolls back (canon §5).
 */
export type AwardXpOutcome = {
  awarded: boolean;
  delta?: number;
  reason?: 'gamification_disabled' | 'duplicate';
};

/**
 * Result of a `revertLikeXp` attempt. Same canon §5 contract:
 *
 *   - `gamification_disabled` — killswitch was off at revert time; no-op.
 *   - `not_found`             — no prior XpEvent row matched the triple (e.g.
 *                               killswitch was off at like-time, like predates
 *                               Phase 2, or replay/race).
 *
 * Counters are NEVER decremented below zero — the conditional `findUnique`
 * guarantees the decrement-pair only runs when a real row exists.
 */
export type RevertLikeXpOutcome = {
  reverted: boolean;
  reason?: 'gamification_disabled' | 'not_found';
};

/**
 * Positional 4-arg signature per canon §4: `awardXp(tx, garageId, reason, opts)`.
 * Matches the skeleton + every consumer chunk (29-35). Opts shape:
 *
 *   - `sourceRef`: REQUIRED, non-null at the awarder boundary (canon §7).
 *   - `delta`:     ONLY `admin_adjustment` consumes this (signed; §C8). Other
 *                  reasons resolve their delta from the §437 rules table.
 *   - `rarity`:    ONLY `badge_award` consumes this (resolves +25 / +50 / +100).
 */
export type AwardXpOpts = {
  sourceRef: string;
  delta?: number;
  rarity?: BadgeRarity;
};

/**
 * §437 rules table — XP delta per reason. `admin_adjustment` is the only signed
 * reason (§C8); `badge_award` resolves via `opts.rarity`. All others positive.
 */
const XP_DELTAS = {
  event_checkin: 10,
  car_create: 5,
  post_create: 2,
  post_like: 1,
  badge_award: { common: 25, rare: 50, legendary: 100 } as const,
  premium_activation: 200,
} as const;

const resolveDelta = (reason: XpReason, opts: AwardXpOpts): number => {
  if (reason === 'admin_adjustment') {
    if (opts.delta === undefined) throw new Error('admin_adjustment requires opts.delta');
    return opts.delta;
  }
  if (reason === 'badge_award') {
    if (!opts.rarity) throw new Error('badge_award requires opts.rarity');
    return XP_DELTAS.badge_award[opts.rarity];
  }
  return XP_DELTAS[reason];
};

/**
 * Invariants:
 *   1. Killswitch first — sync read via `tx` (§C5). No cache. Returns
 *      `{ awarded: false, reason: 'gamification_disabled' }` without DB writes.
 *   2. Same-tx — caller owns the transaction. XpEvent + Garage.xp increment land
 *      or roll back atomically with the parent write.
 *   3. Idempotency — DB `@@unique([garageId, reason, sourceRef])` (§C1). A
 *      `SAVEPOINT awardxp` wraps the awarder's own writes. On ANY failure we
 *      always `ROLLBACK TO SAVEPOINT awardxp` + `RELEASE SAVEPOINT awardxp`
 *      BEFORE deciding to swallow (P2002) or rethrow. This clears Postgres
 *      state 25P02 (in_failed_sql_transaction) for the awarder's writes and
 *      removes the savepoint marker so the parent `$transaction` is left in
 *      a clean, writable state regardless of which branch we take. Prisma's
 *      `$transaction` does NOT auto-savepoint per statement — without this
 *      guard a bare try/catch lets the parent's other writes silently abort
 *      on commit. Never pre-read.
 *   4. `post_like` ALSO increments `Garage.likesReceived` in the SAME
 *      `tx.garage.update` (canon §6). The awarder owns this counter end-to-end;
 *      chunk 32 (route hook) MUST NOT touch `likesReceived` directly.
 *   5. Error contract (canon §5): P2002 → silent duplicate; any other error
 *      RETHROWS so the parent tx rolls back IF the caller propagates the
 *      throw. Callers that log+swallow (cars/feed/check-in/signup hooks) will
 *      still get a clean parent tx because the savepoint cleanup has already
 *      run by the time the throw surfaces — they will not poison commit.
 */
export const awardXp = async (
  tx: Prisma.TransactionClient,
  garageId: string,
  reason: XpReason,
  opts: AwardXpOpts,
): Promise<AwardXpOutcome> => {
  // canon §7: sourceRef is non-null at the awarder boundary. The DB column stays
  // nullable for migration compat, but Postgres unique constraints do not dedupe
  // NULL — a missing sourceRef would silently break @@unique([garageId, reason,
  // sourceRef]) idempotency. Reject empty/missing at the boundary. TS forbids
  // undefined/null at compile time; this guard catches runtime bypass (`as any`,
  // dynamic data, future refactors) and empty string. Throws → parent tx rolls
  // back per canon §5.
  if (!opts.sourceRef) throw new Error('awardXp: opts.sourceRef is required and must be non-empty');

  const enabled = await readGamificationEnabled(tx);
  if (!enabled) return { awarded: false, reason: 'gamification_disabled' };

  const delta = resolveDelta(reason, opts);
  // admin_adjustment is the only reason accepting non-positive deltas (§C8).
  // The admin route (chunk 35) rejects delta === 0 and bounds-checks [-10000, 10000].

  // post_like co-increments likesReceived in the same statement (canon §6).
  const garageData: Prisma.GarageUpdateInput =
    reason === 'post_like'
      ? { xp: { increment: delta }, likesReceived: { increment: 1 } }
      : { xp: { increment: delta } };

  // Wrap awarder writes in a Postgres SAVEPOINT so ANY failure inside
  // `tx.xpEvent.create` or `tx.garage.update` does NOT poison the parent
  // `$transaction`. Prisma's `$transaction` does not auto-savepoint per
  // statement; without this guard a failed statement puts the tx in state
  // 25P02 (in_failed_sql_transaction) and the parent's other writes silently
  // abort on commit.
  await tx.$executeRawUnsafe('SAVEPOINT awardxp');
  try {
    await tx.xpEvent.create({
      data: { garageId, delta, reason, sourceRef: opts.sourceRef },
    });
    await tx.garage.update({ where: { id: garageId }, data: garageData });
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT awardxp');
    return { awarded: true, delta };
  } catch (e) {
    // Always restore the parent tx to a writable state BEFORE deciding to
    // swallow (P2002) or rethrow. `ROLLBACK TO SAVEPOINT awardxp` clears
    // the 25P02 in_failed_sql_transaction state for everything written
    // inside the savepoint; the explicit `RELEASE SAVEPOINT awardxp`
    // removes the savepoint marker so it does not accumulate when callers
    // issue multiple awardXp calls in one parent $transaction. This makes
    // the awarder safe to use under callers that log+swallow the throw
    // (cars/feed/check-in/signup hooks): even when they suppress the
    // exception, the parent tx is already clean and commit will succeed.
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT awardxp');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT awardxp');
    if (isUniqueConstraintError(e)) {
      return { awarded: false, reason: 'duplicate' };
    }
    // canon §5: rethrow non-P2002. Parent tx still rolls back if the caller
    // propagates the throw; if the caller swallows, the parent is clean.
    throw e;
  }
};

/**
 * §C2 — Hard-delete the matching XpEvent row + decrement BOTH counters
 * (`xp` and `likesReceived`) in one `tx.garage.update`. Awarder owns
 * `likesReceived` end-to-end (canon §6). NO -1 audit row left behind
 * (§"Locked invariants" #4). The conditional `findUnique` + `deleteMany`
 * pair prevents counters going negative when:
 *   - killswitch was off at like-time (no prior XpEvent),
 *   - like predates Phase 2 launch (no backfill),
 *   - replay / race — concurrent reverts both see the row, the loser's
 *     `deleteMany` resolves to `{ count: 0 }` and returns `not_found`
 *     instead of throwing P2025.
 *
 * Error contract mirrors `awardXp` (canon §5): silent no-op on
 * killswitch-off / not-found; any other error rethrows so the parent
 * tx rolls back.
 */
export const revertLikeXp = async (
  tx: Prisma.TransactionClient,
  postId: string,
  reactionId: string, // opaque, NOT likerUserId §C3
  authorGarageId: string,
): Promise<RevertLikeXpOutcome> => {
  const enabled = await readGamificationEnabled(tx);
  if (!enabled) return { reverted: false, reason: 'gamification_disabled' };

  const sourceRef = `post:${postId}:reaction:${reactionId}`;
  const row = await tx.xpEvent.findUnique({
    where: {
      garageId_reason_sourceRef: { garageId: authorGarageId, reason: 'post_like', sourceRef },
    },
  });
  if (!row) return { reverted: false, reason: 'not_found' };

  // Race-safe delete: two concurrent reverts both see the row in their snapshot
  // under read-committed (Prisma's default). A bare `tx.xpEvent.delete({ where:
  // { id } })` would throw P2025 on the loser. `deleteMany` returns `{ count }`
  // and never throws on missing row, so the loser cleanly returns `not_found`
  // and we only decrement when count === 1. This preserves canon §5 (no extra
  // catch needed) and guarantees the counters never go negative.
  const { count } = await tx.xpEvent.deleteMany({ where: { id: row.id } });
  if (count === 0) return { reverted: false, reason: 'not_found' };

  await tx.garage.update({
    where: { id: authorGarageId },
    data: { xp: { decrement: row.delta }, likesReceived: { decrement: 1 } },
  });
  return { reverted: true };
};
