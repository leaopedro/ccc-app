import type { BoxView } from '@ccc/shared/box';
import type { Prisma } from '@prisma/client';

import type { Uploads } from '../uploads/types.js';

export type MonthlyBoxWithLines = Prisma.MonthlyBoxGetPayload<{
  include: {
    items: { include: { catalogItem: true } };
    partnerItems: { include: { partnerModule: true } };
  };
}>;

export const serializeBox = (box: MonthlyBoxWithLines, uploads: Uploads): BoxView => ({
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
  orderId: box.orderId,
  autoSendOptIn: box.autoSendOptIn,
  shippingAddressId: box.shippingAddressId,
  items: box.items.map((i) => ({
    catalogItemId: i.catalogItemId,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    subtotalCents: i.subtotalCents,
    titleSnapshot: i.titleSnapshot,
    imageUrl: i.catalogItem?.imageObjectKey
      ? uploads.buildPublicUrl(i.catalogItem.imageObjectKey)
      : null,
    included: i.included,
    dropReason: i.dropReason,
  })),
  partnerItems: box.partnerItems.map((i) => ({
    partnerModuleId: i.partnerModuleId,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    subtotalCents: i.subtotalCents,
    nameSnapshot: i.nameSnapshot,
    imageUrl: i.partnerModule?.imageObjectKey
      ? uploads.buildPublicUrl(i.partnerModule.imageObjectKey)
      : null,
    included: i.included,
    dropReason: i.dropReason,
  })),
});
