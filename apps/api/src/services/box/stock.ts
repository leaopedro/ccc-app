import type { Prisma } from '@prisma/client';

/**
 * Atomically reserve `quantity` units for an item in a cycle.
 * capacity === null means the item is unlimited: no ledger, always ok.
 * Returns false when the reservation would exceed capacity (sold out).
 */
export const reserveCycleStock = async (
  tx: Prisma.TransactionClient,
  args: { catalogItemId: string; cycleKey: string; capacity: number | null; quantity: number },
): Promise<boolean> => {
  if (args.capacity === null) return true;
  if (args.quantity <= 0) return true;

  // Ensure the ledger row exists for this cycle (idempotent).
  await tx.boxCatalogItemCycleStock.upsert({
    where: {
      catalogItemId_cycleKey: { catalogItemId: args.catalogItemId, cycleKey: args.cycleKey },
    },
    update: {},
    create: { catalogItemId: args.catalogItemId, cycleKey: args.cycleKey, total: args.capacity },
  });

  // Conditional atomic decrement: only reserve if it still fits.
  const res = await tx.boxCatalogItemCycleStock.updateMany({
    where: {
      catalogItemId: args.catalogItemId,
      cycleKey: args.cycleKey,
      reserved: { lte: args.capacity - args.quantity },
    },
    data: { reserved: { increment: args.quantity } },
  });
  return res.count === 1;
};

/** Return reserved units to the pool. No-op if there is no ledger row. */
export const releaseCycleStock = async (
  tx: Prisma.TransactionClient,
  args: { catalogItemId: string; cycleKey: string; quantity: number },
): Promise<void> => {
  if (args.quantity <= 0) return;
  await tx.boxCatalogItemCycleStock.updateMany({
    where: {
      catalogItemId: args.catalogItemId,
      cycleKey: args.cycleKey,
      reserved: { gte: args.quantity },
    },
    data: { reserved: { decrement: args.quantity } },
  });
};
