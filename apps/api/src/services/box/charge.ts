const normalizeCep = (cep: string): string => cep.replace(/\D/g, '');

/** True when the postal code falls inside any free-shipping numeric range. */
export const isFreeShippingCep = (
  postalCode: string,
  ranges: Array<{ from: string; to: string }>,
): boolean => {
  const n = Number(normalizeCep(postalCode));
  if (!Number.isFinite(n)) return false;
  return ranges.some((r) => {
    const from = Number(normalizeCep(r.from));
    const to = Number(normalizeCep(r.to));
    return n >= from && n <= to;
  });
};

/** Server-authoritative charge: overflow over budget + partner modules + shipping. */
export const computeBoxCharge = (input: {
  items: Array<{ subtotalCents: number }>;
  partnerItems: Array<{ subtotalCents: number }>;
  budgetCents: number;
  shippingCents: number;
}): {
  itemsTotalCents: number;
  partnersTotalCents: number;
  overflowCents: number;
  chargeCents: number;
} => {
  const itemsTotalCents = input.items.reduce((s, i) => s + i.subtotalCents, 0);
  const partnersTotalCents = input.partnerItems.reduce((s, i) => s + i.subtotalCents, 0);
  const overflowCents = Math.max(0, itemsTotalCents - input.budgetCents);
  const chargeCents = overflowCents + partnersTotalCents + input.shippingCents;
  return { itemsTotalCents, partnersTotalCents, overflowCents, chargeCents };
};
