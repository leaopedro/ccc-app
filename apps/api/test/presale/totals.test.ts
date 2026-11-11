import { describe, expect, it } from 'vitest';

import { cepInRanges, computePresaleTotals } from '../../src/services/presale/totals.js';

describe('cepInRanges', () => {
  it('faixas vazias nunca liberam entrega', () => {
    // Review Focus 1
    expect(cepInRanges('80010000', [])).toBe(false);
  });

  it('aceita CEP dentro da faixa, com e sem máscara', () => {
    const r = [{ start: '80000-000', end: '83800-000' }];
    expect(cepInRanges('80010000', r)).toBe(true);
    expect(cepInRanges('80010-000', r)).toBe(true);
  });

  it('recusa CEP fora da faixa', () => {
    expect(cepInRanges('01001000', [{ start: '80000000', end: '83800000' }])).toBe(false);
  });

  // A faixa com `start: '00000000'` é o que expõe o bug: sem a checagem de
  // comprimento, um CEP malformado normaliza para `0` e passaria como
  // "dentro da faixa". Uma faixa realista (ex. 80000000-83800000) passaria
  // com ou sem o fix, então não provaria nada.
  it('recusa CEP que normaliza para string vazia, mesmo com faixa que começa em zero', () => {
    expect(cepInRanges('abc', [{ start: '00000000', end: '99999999' }])).toBe(false);
  });

  it('recusa CEP com menos de 8 dígitos, mesmo com faixa que começa em zero', () => {
    expect(cepInRanges('8001000', [{ start: '00000000', end: '99999999' }])).toBe(false);
  });

  it('recusa CEP com mais de 8 dígitos, mesmo com faixa que começa em zero', () => {
    expect(cepInRanges('800100000', [{ start: '00000000', end: '99999999' }])).toBe(false);
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
