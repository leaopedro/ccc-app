import type { BoxView } from '@ccc/shared/box';
import type { Prisma } from '@prisma/client';

export type MonthlyBoxWithLines = Prisma.MonthlyBoxGetPayload<{
  include: { items: true; partnerItems: true };
}>;

export const serializeBox = (box: MonthlyBoxWithLines): BoxView => ({
  id: box.id,
  status: box.status,
  cycleKey: box.cycleKey,
  cutoffAt: box.cutoffAt.toISOString(),
  budgetCents: box.budgetCentsSnapshot,
  currency: box.currency,
  itemsTotalCents: box.itemsTotalCents,
  partnersTotalCents: box.partnersTotalCents,
  overflowCents: box.overflowCents,
  shippingCents: box.shippingCents,
  chargeCents: box.chargeCents,
  autoSendOptIn: box.autoSendOptIn,
  items: box.items
    .filter((i) => i.included)
    .map((i) => ({
      catalogItemId: i.catalogItemId,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      subtotalCents: i.subtotalCents,
      titleSnapshot: i.titleSnapshot,
    })),
  partnerItems: box.partnerItems
    .filter((i) => i.included)
    .map((i) => ({
      partnerModuleId: i.partnerModuleId,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      subtotalCents: i.subtotalCents,
      nameSnapshot: i.nameSnapshot,
    })),
});
