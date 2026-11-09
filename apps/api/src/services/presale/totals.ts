// Totais da pré-venda: subtotal, frete e faixa de CEP. Nenhuma função aqui
// aplica DEV_FEE_PERCENT — a pré-venda cobra o preço base puro, por decisão
// do dono do produto (ver services/pricing/dev-fee.ts, que não é importado).
//
// `cepInRanges` duplica deliberadamente a aritmética de
// `services/box/charge.ts:4-15` (isFreeShippingCep). Aquele arquivo é do Box
// mensal (assinatura premium, produto diferente) e fica intocado por este
// task; reaproveitar de lá acoplaria a pré-venda à caixa mensal. Não
// "conserte" esta duplicação sem reabrir essa decisão com o controlador.
// Esta cópia acrescenta uma checagem de comprimento (exatamente 8 dígitos)
// que o original em box/charge.ts não tem — não faça as duas convergirem,
// isso reabriria a falha de CEP malformado descrita abaixo.
const normalizeCep = (cep: string): string => cep.replace(/\D/g, '');

/** True when the postal code falls inside any delivery-enabled numeric range. */
export const cepInRanges = (
  postalCode: string,
  ranges: Array<{ from: string; to: string }>,
): boolean => {
  const normalized = normalizeCep(postalCode);
  // CEP brasileiro tem 8 dígitos. Sem esta checagem, `Number('')` é `0` (não
  // NaN), então um CEP vazio ou malformado seria comparado como 0 contra as
  // faixas configuradas e passaria se alguma faixa começasse perto de 0 —
  // entrega liberada para endereço nenhum. Falha fechado por construção.
  if (normalized.length !== 8) return false;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return false;
  return ranges.some((r) => {
    const from = Number(normalizeCep(r.from));
    const to = Number(normalizeCep(r.to));
    return n >= from && n <= to;
  });
};

/**
 * Server-authoritative pre-sale totals: subtotal + shipping charged once per order.
 *
 * Assumes `items` is non-empty — an empty cart with `fulfillmentMethod: 'ship'`
 * would otherwise charge shippingCents with no items. That guarantee comes from
 * `presaleCheckoutRequestSchema` (`items: z.array(...).min(1).max(50)` in
 * `packages/shared/src/presale.ts`); Task 7 also rejects a non-positive total
 * independently. No guard added here — the caller already enforces it.
 */
export const computePresaleTotals = (input: {
  items: Array<{ priceCents: number; quantity: number }>;
  fulfillmentMethod: 'pickup' | 'ship';
  shippingFeeCents: number;
}): {
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
} => {
  const subtotalCents = input.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const shippingCents = input.fulfillmentMethod === 'ship' ? input.shippingFeeCents : 0;
  return {
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
  };
};
