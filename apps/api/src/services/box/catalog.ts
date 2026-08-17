import { meetsMinTier, type BoxCatalog } from '@ccc/shared/box';
import type { GaragePremiumTier } from '@ccc/shared/garage';
import { prisma } from '@ccc/db';

import type { Uploads } from '../uploads/types.js';

/** Read model for the attendee builder: active catalog + partners with soldOut flags. */
export const buildBoxCatalog = async (
  uploads: Uploads,
  cycleKey: string,
  userTier: GaragePremiumTier,
): Promise<BoxCatalog> => {
  const items = await prisma.boxCatalogItem.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  const ledger = await prisma.boxCatalogItemCycleStock.findMany({ where: { cycleKey } });
  const ledgerById = new Map(ledger.map((l) => [l.catalogItemId, l]));

  // Hide items the member may not see; keep locked ones (flagged) for upsell.
  const visible = items.filter((i) => {
    if (meetsMinTier(userTier, i.minTier)) return true;
    return i.restrictedDisplay === 'locked';
  });

  const catalogItems = visible.map((i) => {
    const row = ledgerById.get(i.id);
    // The ledger row is the cycle's stock snapshot: its total is captured when
    // the cycle first reserves stock and never follows later catalog edits. Use
    // it when present; fall back to the current stockPerCycle for a cycle that
    // has not reserved yet. null capacity means unlimited (never soldOut).
    const total = row ? row.total : i.stockPerCycle;
    const reserved = row ? row.reserved : 0;
    // soldOut only when a finite stock exists and nothing is left. Advisory:
    // the atomic reservation at confirm/cutoff is the real gate. Read is
    // intentionally outside any transaction.
    const soldOut = total != null && total - reserved <= 0;
    const locked = !meetsMinTier(userTier, i.minTier);
    return {
      id: i.id,
      title: i.title,
      category: i.category,
      imageUrl: i.imageObjectKey ? uploads.buildPublicUrl(i.imageObjectKey) : null,
      priceCents: i.priceCents,
      maxPerCycle: i.maxPerCycle,
      soldOut,
      locked,
      minTier: i.minTier,
    };
  });

  const partners = await prisma.partner.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    include: { modules: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
  });

  return {
    categories: [...new Set(visible.map((i) => i.category))],
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
