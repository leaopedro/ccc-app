import { fileURLToPath } from 'node:url';

import { prisma } from '@ccc/db';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Marks pre-cutover revenue rows as `livemode = false`.
 *
 * Why creation time and not the provider id: Stripe test-mode ids for
 * Customer, Subscription and PaymentIntent are indistinguishable from live
 * ones. The mode lives in the provider's own `livemode` field, never in the
 * id string, so no string match can work. Same discriminator as
 * `purge-test-mode.ts`.
 *
 * There is no default cutoff on purpose. Guessing it hides real revenue from
 * the first finance report, or leaves test money in it. The instant is the
 * live cutover moment and it is a human decision.
 *
 * Idempotent: it only touches rows still at `livemode = true`.
 */
export type MarkPreCutoverOptions = {
  /** Cutover instant. Rows created strictly before this are test-mode. */
  createdBefore: Date;
  dryRun?: boolean;
};

export type MarkPreCutoverResult = {
  orders: number;
  membershipInvoices: number;
};

type Client = PrismaClient | Prisma.TransactionClient;

export const markPreCutoverRows = async (
  client: Client,
  opts: MarkPreCutoverOptions,
): Promise<MarkPreCutoverResult> => {
  const { createdBefore, dryRun = false } = opts;

  const orderWhere = { livemode: true, createdAt: { lt: createdBefore } };
  const invoiceWhere = { livemode: true, createdAt: { lt: createdBefore } };

  const orders = await client.order.count({ where: orderWhere });
  const membershipInvoices = await client.premiumMembershipInvoice.count({
    where: invoiceWhere,
  });

  if (dryRun) return { orders, membershipInvoices };

  await client.order.updateMany({ where: orderWhere, data: { livemode: false } });
  await client.premiumMembershipInvoice.updateMany({
    where: invoiceWhere,
    data: { livemode: false },
  });

  return { orders, membershipInvoices };
};

/**
 * CLI entry point. Import-safe: the body only runs when this file is the
 * process entry, so the test suite can import markPreCutoverRows without
 * executing it.
 *
 *   pnpm --filter @ccc/api exec tsx src/scripts/mark-pre-cutover-orders.ts \
 *     --created-before=2026-09-01T00:00:00Z --dry-run
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
      markPreCutoverRows(prisma, { createdBefore, dryRun })
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
