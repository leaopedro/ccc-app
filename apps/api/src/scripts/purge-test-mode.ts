import { fileURLToPath } from 'node:url';

import { prisma } from '@ccc/db';
import type { PrismaClient } from '@prisma/client';

/**
 * One-shot cutover script: quarantine rows that reference Stripe test-mode
 * objects, so they cannot poison the live account.
 *
 * Production ran entirely in test mode before the live cutover. Every row that
 * survives the key flip while pointing at a `cus_test_...` / `sub_test_...` /
 * `pi_test_...` becomes a permanent fault:
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
 * Run with --dry-run first and eyeball the counts against production.
 */

/**
 * Stripe test-mode ids carry `_test_` right after the prefix (`cus_test_...`).
 * Live ids do not. Verify this against a production dump before running for
 * real: an account with legacy ids that predate the convention would be missed,
 * and a false positive here revokes entitlement from a paying member.
 */
const TEST_REF = '_test_';

export type PurgeResult = {
  memberships: number;
  garages: number;
  orders: number;
};

export const purgeTestMode = async (
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {},
): Promise<PurgeResult> => {
  const staleMemberships = await prisma.premiumMembership.findMany({
    where: {
      status: { not: 'expired' },
      OR: [
        { providerSubRef: { contains: TEST_REF } },
        { providerCustomerRef: { contains: TEST_REF } },
      ],
    },
    select: { id: true, garageId: true },
  });

  const stalePendingOrders = await prisma.order.findMany({
    where: { status: 'pending', providerRef: { contains: TEST_REF } },
    select: { id: true },
  });

  const garageIds = [...new Set(staleMemberships.map((m) => m.garageId))];

  const result: PurgeResult = {
    memberships: staleMemberships.length,
    garages: garageIds.length,
    orders: stalePendingOrders.length,
  };

  if (opts.dryRun) return result;

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

    await tx.order.updateMany({
      where: { id: { in: stalePendingOrders.map((o) => o.id) } },
      data: { status: 'expired' },
    });
  });

  return result;
};

/**
 * CLI entry point. Import-safe: the body only runs when this file is the
 * process entry, so the test suite can import purgeTestMode without executing.
 *
 *   pnpm --filter @ccc/api exec tsx src/scripts/purge-test-mode.ts --dry-run
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dryRun = process.argv.includes('--dry-run');
  purgeTestMode(prisma, { dryRun })
    .then((result) => {
      console.log(JSON.stringify({ dryRun, ...result }, null, 2));
      return prisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      console.error(err);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
