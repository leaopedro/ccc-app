import { describe, expect, it } from 'vitest';

import { cepInRanges, computePresaleTotals } from '../../src/services/presale/totals.js';

describe('cepInRanges', () => {
  it('faixas vazias nunca liberam entrega', () => {
    // Review Focus 1
    expect(cepInRanges('80010000', [])).toBe(false);
  });

  it('aceita CEP dentro da faixa, com e sem máscara', () => {
    const r = [{ from: '80000-000', to: '83800-000' }];
    expect(cepInRanges('80010000', r)).toBe(true);
    expect(cepInRanges('80010-000', r)).toBe(true);
  });

  it('recusa CEP fora da faixa', () => {
    expect(cepInRanges('01001000', [{ from: '80000000', to: '83800000' }])).toBe(false);
  });
});

describe('computePresaleTotals', () => {
  it('retirada zera o frete mesmo com frete configurado', () => {
    // Review Focus 3
    const t = computePresaleTotals({
      items: [{ priceCents: 9900, quantity: 2 }],
      fulfillmentMethod: 'pickup',
      shippingFeeCents: 2500,
    });
    expect(t).toEqual({ subtotalCents: 19800, shippingCents: 0, totalCents: 19800 });
  });

  it('entrega soma o frete uma vez só, não por item', () => {
    const t = computePresaleTotals({
      items: [
        { priceCents: 9900, quantity: 2 },
        { priceCents: 4900, quantity: 3 },
      ],
      fulfillmentMethod: 'ship',
      shippingFeeCents: 2500,
    });
    expect(t).toEqual({ subtotalCents: 34500, shippingCents: 2500, totalCents: 37000 });
  });
});
