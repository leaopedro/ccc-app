import { describe, expect, it } from 'vitest';

import { computeBoxCharge, isFreeShippingCep } from '../../../src/services/box/charge.js';

describe('isFreeShippingCep', () => {
  const ranges = [{ from: '80000-000', to: '83800-999' }];
  it('is free inside the range', () => {
    expect(isFreeShippingCep('81000-000', ranges)).toBe(true);
  });
  it('is not free outside the range', () => {
    expect(isFreeShippingCep('90000-000', ranges)).toBe(false);
  });
  it('tolerates missing hyphen', () => {
    expect(isFreeShippingCep('81000000', ranges)).toBe(true);
  });
});

describe('computeBoxCharge', () => {
  it('charges overflow + partners + shipping', () => {
    const r = computeBoxCharge({
      items: [{ subtotalCents: 12000 }],
      partnerItems: [{ subtotalCents: 3000 }],
      budgetCents: 10000,
      shippingCents: 1990,
    });
    expect(r).toEqual({
      itemsTotalCents: 12000,
      partnersTotalCents: 3000,
      overflowCents: 2000,
      chargeCents: 6990,
    });
  });

  it('is zero when under budget with free shipping', () => {
    const r = computeBoxCharge({
      items: [{ subtotalCents: 4000 }],
      partnerItems: [],
      budgetCents: 10000,
      shippingCents: 0,
    });
    expect(r.chargeCents).toBe(0);
  });
});
