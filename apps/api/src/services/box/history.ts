import type { BoxHistory } from '@ccc/shared/box';
import { prisma } from '@ccc/db';

import type { Uploads } from '../uploads/types.js';

/** Garage-scoped box history, newest first. Not gated on active membership. */
export const listBoxHistory = async (uploads: Uploads, garageId: string): Promise<BoxHistory> => {
  const boxes = await prisma.monthlyBox.findMany({
    where: { garageId },
    // Garage-scoped, so two memberships of the same garage can both have a box
    // in the list, and `cycleStart` alone is not a total order across them: two
    // subscriptions starting the same day tie. Position 0 is load-bearing here
    // — it is what flags `current` below — so tie-break down to `id`.
    orderBy: [{ cycleStart: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: {
      items: {
        where: { included: true },
        take: 3,
        include: { catalogItem: { select: { imageObjectKey: true } } },
      },
    },
  });
  return boxes.map((b, index) => ({
    id: b.id,
    cycleKey: b.cycleKey,
    cycleStart: b.cycleStart.toISOString(),
    status: b.status,
    chargeCents: b.chargeCents,
    thumbnails: b.items
      .map((i) => i.catalogItem?.imageObjectKey)
      .filter((k): k is string => Boolean(k))
      .map((k) => uploads.buildPublicUrl(k)),
    current: index === 0,
  }));
};
