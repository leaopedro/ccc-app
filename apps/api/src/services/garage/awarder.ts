import {
  BADGE_AWARDED_NOTIFICATION_KIND,
  BADGE_AWARDED_NOTIFICATION_TITLE,
  badgeAwardedDedupeKey,
  badgeTitlePtBr,
} from '@ccc/shared/badges-copy';
import type { Prisma } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';
import { recordAudit } from '../admin-audit.js';

import { readGamificationEnabled } from './killswitch.js';
import { awardXp } from './xp-awarder.js';

import { computeIsPremiumActive } from './index.js';

/**
 * Outcome of an attempted badge grant. Returned for every code regardless of
 * the path (auto-award from write hooks, admin manual grant, future XP/streak
 * recompute). The boolean carries the side-effect signal; the optional reason
 * documents why no row landed when `awarded` is `false`.
 *
 *   - `gamification_disabled` — killswitch is off; awarder is a no-op.
 *   - `premium_required`     — the spec is `premiumExclusive` AND the garage
 *                              is not premium-active AND the caller did NOT
 *                              opt into the admin override.
 *   - `already_earned`       — the (garageId, badgeCode) unique constraint
 *                              fired. Idempotent re-award is silently swallowed.
 */
export type AwardBadgeOutcome = {
  awarded: boolean;
  reason?: 'gamification_disabled' | 'premium_required' | 'already_earned';
};

export type AwardBadgeOptions = {
  /** AdminAudit.actorId override. Defaults to `system:awarder`. */
  actorId?: string;
  /**
   * Bypass the premium-exclusive gate for admin-initiated manual grants.
   * Documented exception: kickoff decision allows admins to grant
   * premium-exclusive specs to non-premium users for support cases. The
   * route handler must enforce its own admin-role guard; this flag is the
   * single explicit knob that lets the bypass through.
   */
  allowAdminOverride?: boolean;
  /**
   * Emit an in-app Notification row for the garage owner on a successful
   * award. Defaults to `false` so the implicit write-path hooks (Car.create,
   * FeedPost.create, check-in, signup) stay silent — the mobile app reveals
   * those discoveries by re-rendering the garage screen on next load. Set
   * to `true` from the admin manual-grant route so support actions surface
   * via the existing `GET /me/notifications` poll.
   *
   * Idempotency: the Notification row uses
   * `dedupeKey = badge:${code}:${garage.userId}` against the existing
   * `@@unique([userId, kind, dedupeKey])` index. A re-grant after an
   * un-grant therefore re-mints the GarageBadge but does NOT double-notify.
   * Push delivery is deferred to Phase 2D — we never set `sentAt` here.
   */
  notifyOnGrant?: boolean;
};

/**
 * Single chokepoint for granting a `GarageBadge`. Every award path in the
 * codebase must go through this function — no direct `tx.garageBadge.create`
 * outside this file. Centralizing the killswitch read, the premium-exclusive
 * gate, and the audit row keeps the four invariants in one place:
 *
 *   1. Killswitch first — admin toggle off means zero awards, no exceptions.
 *   2. Premium gate — `Badge.premiumExclusive` requires `isPremiumActive`,
 *      bypassable only via `opts.allowAdminOverride`.
 *   3. Idempotency — the `(garageId, badgeCode)` unique constraint is the
 *      source of truth; we catch the P2002 instead of pre-reading.
 *   4. Audit — every successful insert writes a `badge.award` row that
 *      carries the badge code in `metadata.badgeCode` (matches the chunk
 *      16 pin/unpin audit shape — entityType stays `garage`, the code
 *      lives in metadata so the admin-audit enum doesn't grow per code).
 *
 * `tx` is required: the caller MUST own the surrounding transaction so the
 * award lands or rolls back with whatever write triggered the eligibility
 * check (Car.create, FeedPost.create, etc.). This is what makes the badge
 * grant atomic with the user's action.
 */
export const awardBadge = async (
  tx: Prisma.TransactionClient,
  garageId: string,
  code: string,
  sourceRef: string | null = null,
  opts: AwardBadgeOptions = {},
): Promise<AwardBadgeOutcome> => {
  // 1. Killswitch — admin can flip this in < 1s and the awarder respects it
  // on the very next call. No catalog cache here on purpose; the single-row
  // read is cheap and the staleness budget is zero. Read via `tx` so the
  // killswitch check participates in the caller's transaction snapshot
  // (matters under Serializable isolation).
  const enabled = await readGamificationEnabled(tx);
  if (!enabled) return { awarded: false, reason: 'gamification_disabled' };

  // 2. Badge + garage existence. Both throw on missing because the caller
  // contract is "I just produced a code from eligibility/<surface>.ts against
  // a real garageId" — a miss here is a programmer error worth surfacing.
  const badge = await tx.badge.findUnique({ where: { code } });
  if (!badge) throw new Error(`awardBadge: unknown badge ${code}`);

  const garage = await tx.garage.findUnique({ where: { id: garageId } });
  if (!garage) throw new Error(`awardBadge: unknown garage ${garageId}`);

  // 3. Premium gate — single source of truth. Eligibility files don't reason
  // about premium; they just return codes. The gate fires here per-code so
  // a mixed-premium batch (e.g. CCC-001 free + CCC-003 premium) lands the
  // free entries even when the premium ones are blocked.
  if (badge.premiumExclusive) {
    const isPremium = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
    if (!isPremium && !opts.allowAdminOverride) {
      return { awarded: false, reason: 'premium_required' };
    }
  }

  // 4. Insert + audit. Idempotency is enforced by the @@unique([garageId,
  // badgeCode]) on GarageBadge — we catch P2002 instead of pre-reading
  // because the read-then-write pattern races under concurrency (two
  // simultaneous write-paths both observe "not earned" and both insert).
  try {
    await tx.garageBadge.create({
      data: { garageId, badgeCode: code, sourceRef },
    });
    await recordAudit(
      {
        actorId: opts.actorId ?? 'system:awarder',
        action: 'badge.award',
        entityType: 'garage',
        entityId: garageId,
        metadata: { badgeCode: code, sourceRef },
      },
      tx,
    );

    // 4a. XP award for the badge. Rarity → delta mapping lives in the XP
    // awarder (chunk 27); we pass the rarity through. Per canon §5:
    // awardXp silently no-ops on killswitch-off + P2002 and returns
    // { awarded: false, ... }; any other error rethrows so the parent
    // $transaction rolls back the GarageBadge insert + audit row + the
    // would-be XpEvent atomically. NO local try/catch here — that would
    // mask genuine bugs and break same-tx atomicity (canon §5).
    await awardXp(tx, garageId, 'badge_award', {
      sourceRef: `badge:${code}`,
      rarity: badge.rarity,
    });

    // 5. Optional in-app notification. Only the admin manual-grant route
    // opts in via `notifyOnGrant: true`. Write-path hooks (cars/feed/
    // check-in/signup) pass nothing, so the default `false` keeps them
    // silent — the user discovers those badges on the next garage render.
    //
    // The Notification participates in the caller's transaction so a
    // failure mid-write rolls back the inbox row alongside the GarageBadge.
    // The unique index `@@unique([userId, kind, dedupeKey])` swallows the
    // re-grant case (un-grant → re-grant) without inserting a duplicate.
    if (opts.notifyOnGrant) {
      try {
        await tx.notification.create({
          data: {
            userId: garage.userId,
            kind: BADGE_AWARDED_NOTIFICATION_KIND,
            title: BADGE_AWARDED_NOTIFICATION_TITLE,
            body: badgeTitlePtBr(code),
            data: { kind: BADGE_AWARDED_NOTIFICATION_KIND, code } as Prisma.InputJsonValue,
            dedupeKey: badgeAwardedDedupeKey(code, garage.userId),
          },
        });
      } catch (notifyErr) {
        // Dedupe collision (un-grant → re-grant) is a silent no-op: the
        // historical "you earned X" event already lives in the inbox and
        // we don't want to double-notify on a re-mint. Any other failure
        // bubbles so the surrounding transaction rolls back the award.
        if (!isUniqueConstraintError(notifyErr)) throw notifyErr;
      }
    }

    return { awarded: true };
  } catch (e) {
    if (isUniqueConstraintError(e)) return { awarded: false, reason: 'already_earned' };
    throw e;
  }
};
