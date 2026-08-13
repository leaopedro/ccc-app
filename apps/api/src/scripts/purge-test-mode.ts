import { fileURLToPath } from 'node:url';

import { prisma } from '@ccc/db';
import type { PrismaClient } from '@prisma/client';

import { releaseAllReservationsForOrders } from '../services/orders/expire.js';

/**
 * One-shot cutover script: quarantine rows that reference Stripe test-mode
 * objects, so they cannot poison the live account.
 *
 * Production ran entirely in test mode before the live cutover. Every row that
 * survives the key flip while pointing at a test-mode object becomes a permanent
 * fault:
 *
 *   - `providerSubRef` of test: the hourly reconcile sweep throws on that row,
 *     its per-row catch logs and moves on, and the membership NEVER expires.
 *     `Garage.premiumTier` stays set, so the member keeps full premium
 *     entitlement forever with no live subscription behind it. Silent by design.
 *   - `providerCustomerRef` of test: portal mints raise resource_missing (now a
 *     typed 409, see services/billing/stale-ref.ts) and the member cannot manage
 *     or re-subscribe until the row is fixed.
 *   - `Order.providerRef` of test on a pending order: resume can never succeed.
 *
 * Run with `--dry-run` first and eyeball the counts against production.
 */

/**
 * WHY A TIMESTAMP AND NOT THE ID.
 *
 * The first version of this script matched `_test_` inside the stored refs. That
 * is wrong: Stripe's test-mode object ids for Customer, Subscription and
 * PaymentIntent look exactly like live ones (`cus_NffrFeUfNV2Hib`), and the mode
 * is exposed as `livemode` on the object, not in the id. Only a few resources —
 * Checkout Session, for one — carry the mode in the id, and none of those are
 * stored in the columns this script reads. The predicate would have reported
 * zero while every stale row stayed in place, which is worse than not running
 * the script at all, because the dry run would read as "nothing to do".
 *
 * The honest discriminator is time. Production accepted no live payment before
 * the cutover, so every membership and every pending order created before that
 * instant references a test-mode object. The caller MUST pass that instant; there
 * is deliberately no default, because guessing it revokes entitlement from
 * paying members.
 */
export type PurgeOptions = {
  /** Cutover instant. Rows created strictly before this are test-mode. */
  createdBefore: Date;
  dryRun?: boolean;
};

export type PurgeResult = {
  memberships: number;
  garages: number;
  orders: number;
};

export const purgeTestMode = async (
  prisma: PrismaClient,
  opts: PurgeOptions,
): Promise<PurgeResult> => {
  const { createdBefore, dryRun = false } = opts;

  const staleMemberships = await prisma.premiumMembership.findMany({
    where: { status: { not: 'expired' }, createdAt: { lt: createdBefore } },
    select: { id: true, garageId: true },
  });

  const stalePendingOrders = await prisma.order.findMany({
    where: { status: 'pending', createdAt: { lt: createdBefore } },
    select: { id: true },
  });

  const garageIds = [...new Set(staleMemberships.map((m) => m.garageId))];

  const result: PurgeResult = {
    memberships: staleMemberships.length,
    garages: garageIds.length,
    orders: stalePendingOrders.length,
  };

  if (dryRun) return result;

  await prisma.$transaction(async (tx) => {
    await tx.premiumMembership.updateMany({
      where: { id: { in: staleMemberships.map((m) => m.id) } },
      data: { status: 'expired' },
    });

    // The entitlement snapshot lives on Garage, not on the membership. Leaving
    // it set is what produces permanent free premium after the flip.
    await tx.garage.updateMany({
      where: { id: { in: garageIds } },
      data: { premiumTier: null, premiumUntil: null },
    });

    const orderIds = stalePendingOrders.map((o) => o.id);

    // Release the stock these orders were holding BEFORE flipping their status.
    // Setting `expired` directly would leave TicketTier / Variant / TicketExtra
    // quantitySold permanently inflated: the regular expiry sweeps only look at
    // `pending` rows, so nothing would ever repair the counters.
    await releaseAllReservationsForOrders(tx, orderIds);

    await tx.order.updateMany({
      where: { id: { in: orderIds } },
      data: { status: 'expired' },
    });
  });

  return result;
};

/**
 * CLI entry point. Import-safe: the body only runs when this file is the
 * process entry, so the test suite can import purgeTestMode without executing.
 *
 *   pnpm --filter @ccc/api exec tsx src/scripts/purge-test-mode.ts \
 *     --created-before=2026-08-20T00:00:00Z --dry-run
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dryRun = process.argv.includes('--dry-run');
  const raw = process.argv.find((a) => a.startsWith('--created-before='))?.split('=')[1];

  if (!raw) {
    console.error(
      'Missing --created-before=<ISO instant>. This is the live cutover moment: rows created before it are test-mode. There is no default on purpose.',
    );
    process.exitCode = 1;
  } else {
    const createdBefore = new Date(raw);
    if (Number.isNaN(createdBefore.getTime())) {
      console.error(`--created-before is not a valid date: ${raw}`);
      process.exitCode = 1;
    } else {
      purgeTestMode(prisma, { createdBefore, dryRun })
        .then((result) => {
          console.log(JSON.stringify({ dryRun, createdBefore: raw, ...result }, null, 2));
          return prisma.$disconnect();
        })
        .catch(async (err: unknown) => {
          console.error(err);
          await prisma.$disconnect();
          process.exitCode = 1;
        });
    }
  }
}
