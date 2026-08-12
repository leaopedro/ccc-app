import type { BoxCatalog } from '@ccc/shared/box';
import { prisma } from '@ccc/db';

import type { Uploads } from '../uploads/types.js';

/** Read model for the attendee builder: active catalog + partners with soldOut flags. */
export const buildBoxCatalog = async (uploads: Uploads, cycleKey: string): Promise<BoxCatalog> => {
  const items = await prisma.boxCatalogItem.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  const ledger = await prisma.boxCatalogItemCycleStock.findMany({ where: { cycleKey } });
  const reservedById = new Map(ledger.map((l) => [l.catalogItemId, l.reserved]));

  const catalogItems = items.map((i) => {
    const reserved = reservedById.get(i.id) ?? 0;
    // soldOut only when a finite stock exists and nothing is left. Advisory:
    // the atomic reservation at confirm/cutoff is the real gate. Read is
    // intentionally outside any transaction.
    const soldOut = i.stockPerCycle != null && i.stockPerCycle - reserved <= 0;
    return {
      id: i.id,
      title: i.title,
      category: i.category,
      imageUrl: i.imageObjectKey ? uploads.buildPublicUrl(i.imageObjectKey) : null,
      priceCents: i.priceCents,
      maxPerCycle: i.maxPerCycle,
      soldOut,
    };
  });

  const partners = await prisma.partner.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    include: { modules: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
  });

  return {
    categories: [...new Set(items.map((i) => i.category))],
    items: catalogItems,
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      logoUrl: p.logoObjectKey ? uploads.buildPublicUrl(p.logoObjectKey) : null,
      description: p.description,
      modules: p.modules.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        imageUrl: m.imageObjectKey ? uploads.buildPublicUrl(m.imageObjectKey) : null,
        priceCents: m.priceCents,
      })),
    })),
  };
};
