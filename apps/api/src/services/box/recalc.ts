import type { Prisma } from '@prisma/client';

import { computeBoxCharge } from './charge.js';

/** Recompute and persist the box money totals from its included lines. */
export const recalcBoxTotals = async (
  tx: Prisma.TransactionClient,
  boxId: string,
): Promise<void> => {
  const box = await tx.monthlyBox.findUniqueOrThrow({
    where: { id: boxId },
    include: { items: true, partnerItems: true },
  });
  const items = box.items
    .filter((i) => i.included)
    .map((i) => ({ subtotalCents: i.subtotalCents }));
  const partnerItems = box.partnerItems
    .filter((i) => i.included)
    .map((i) => ({ subtotalCents: i.subtotalCents }));
  const totals = computeBoxCharge({
    items,
    partnerItems,
    budgetCents: box.budgetCentsSnapshot,
    shippingCents: box.shippingCents,
  });
  await tx.monthlyBox.update({
    where: { id: boxId },
    data: {
      itemsTotalCents: totals.itemsTotalCents,
      partnersTotalCents: totals.partnersTotalCents,
      overflowCents: totals.overflowCents,
      chargeCents: totals.chargeCents,
    },
  });
};
