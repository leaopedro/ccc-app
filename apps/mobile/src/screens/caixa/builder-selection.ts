import type { BoxCatalog, BoxSelectionUpdate, BoxView } from '@ccc/shared/box';

export type SelectionMap = Record<string, number>;

export type PriceIndex = {
  items: Record<string, number>;
  partners: Record<string, number>;
};

export type OptimisticTotals = {
  itemsTotalCents: number;
  includedCents: number;
  overflowCents: number;
  partnersTotalCents: number;
  chargeCents: number;
  catalogCount: number;
};

export function seedSelection(box: Pick<BoxView, 'items' | 'partnerItems'>): {
  items: SelectionMap;
  partners: SelectionMap;
} {
  const items: SelectionMap = {};
  for (const line of box.items) items[line.catalogItemId] = line.quantity;
  const partners: SelectionMap = {};
  for (const line of box.partnerItems) partners[line.partnerModuleId] = line.quantity;
  return { items, partners };
}

// Existing lines keep the box snapshot price (R14). New items use the catalog
// price. Partner modules always use the catalog price.
export function buildPriceIndex(
  box: Pick<BoxView, 'items' | 'partnerItems'>,
  catalog: Pick<BoxCatalog, 'items' | 'partners'>,
): PriceIndex {
  const items: Record<string, number> = {};
  for (const c of catalog.items) items[c.id] = c.priceCents;
  for (const line of box.items) items[line.catalogItemId] = line.unitPriceCents;

  const partners: Record<string, number> = {};
  for (const p of catalog.partners) {
    for (const m of p.modules) partners[m.id] = m.priceCents;
  }
  for (const line of box.partnerItems) partners[line.partnerModuleId] = line.unitPriceCents;

  return { items, partners };
}

export function computeOptimisticTotals(
  items: SelectionMap,
  partners: SelectionMap,
  prices: PriceIndex,
  budgetCents: number,
): OptimisticTotals {
  let itemsTotalCents = 0;
  let catalogCount = 0;
  for (const [id, qty] of Object.entries(items)) {
    if (qty <= 0) continue;
    itemsTotalCents += (prices.items[id] ?? 0) * qty;
    catalogCount += qty;
  }
  let partnersTotalCents = 0;
  for (const [id, qty] of Object.entries(partners)) {
    if (qty <= 0) continue;
    partnersTotalCents += (prices.partners[id] ?? 0) * qty;
  }
  const includedCents = Math.min(itemsTotalCents, budgetCents);
  const overflowCents = Math.max(0, itemsTotalCents - budgetCents);
  const chargeCents = overflowCents + partnersTotalCents;
  return {
    itemsTotalCents,
    includedCents,
    overflowCents,
    partnersTotalCents,
    chargeCents,
    catalogCount,
  };
}

export function toSelectionUpdate(items: SelectionMap, partners: SelectionMap): BoxSelectionUpdate {
  return {
    items: Object.entries(items)
      .filter(([, q]) => q > 0)
      .map(([catalogItemId, quantity]) => ({ catalogItemId, quantity })),
    partnerItems: Object.entries(partners)
      .filter(([, q]) => q > 0)
      .map(([partnerModuleId, quantity]) => ({ partnerModuleId, quantity })),
  };
}

export function filterByCategory(
  items: BoxCatalog['items'],
  category: string | null,
): BoxCatalog['items'] {
  if (category === null) return items;
  return items.filter((i) => i.category === category);
}

export function summaryState(totals: Pick<OptimisticTotals, 'chargeCents' | 'catalogCount'>): {
  collapsed: boolean;
  catalogCount: number;
} {
  return { collapsed: totals.chargeCents === 0, catalogCount: totals.catalogCount };
}
