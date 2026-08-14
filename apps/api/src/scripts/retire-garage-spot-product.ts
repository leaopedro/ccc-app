import { fileURLToPath } from 'node:url';

import { prisma, GARAGE_SPOT_PRODUCT_SLUG } from '@ccc/db';
import type { PrismaClient } from '@prisma/client';

/**
 * Archives the "Vaga de Garagem Adicional" product in databases that already ran
 * the old seed.
 *
 * Removing the call from the seed only stops NEW environments from getting it.
 * Any database seeded before 2026-08-13 still has the row, and the cart accepts
 * it: `validateProductItem` checks `variant.active` and `product.status`, never
 * `visibleInStore`, and virtual products skip the store-open gate. So anyone
 * holding a cached or guessed variant id could still buy a R$49 digital unlock —
 * the exact SKU that has no defense under App Store guideline 3.1.5(a).
 *
 * Archiving is done as data, not as a new cart rule: refusing every virtual
 * product with `visibleInStore: false` would also break legitimate virtual items
 * sold outside the storefront.
 *
 * Idempotent. Safe to run more than once.
 */

export type RetireResult = {
  productsArchived: number;
  variantsDeactivated: number;
};

export const retireGarageSpotProduct = async (
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {},
): Promise<RetireResult> => {
  const product = await prisma.product.findUnique({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    select: { id: true, status: true },
  });

  if (!product) return { productsArchived: 0, variantsDeactivated: 0 };

  const activeVariants = await prisma.variant.count({
    where: { productId: product.id, active: true },
  });

  const result: RetireResult = {
    productsArchived: product.status === 'archived' ? 0 : 1,
    variantsDeactivated: activeVariants,
  };

  if (opts.dryRun) return result;

  await prisma.$transaction(async (tx) => {
    await tx.variant.updateMany({
      where: { productId: product.id, active: true },
      data: { active: false },
    });
    await tx.product.update({
      where: { id: product.id },
      data: { status: 'archived', visibleInStore: false },
    });
  });

  return result;
};

/**
 * CLI entry point. Import-safe.
 *
 *   pnpm --filter @ccc/api exec tsx src/scripts/retire-garage-spot-product.ts --dry-run
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dryRun = process.argv.includes('--dry-run');
  retireGarageSpotProduct(prisma, { dryRun })
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
