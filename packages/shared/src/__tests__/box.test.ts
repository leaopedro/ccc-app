import { describe, expect, it } from 'vitest';

import { boxConfirmSchema, boxSelectionUpdateSchema, boxViewSchema } from '../box.js';

describe('box shared schemas', () => {
  it('parses a full box view', () => {
    const view = {
      id: 'box_1',
      status: 'open',
      cycleKey: '2026-08-01',
      cutoffAt: '2026-08-27T00:00:00.000Z',
      budgetCents: 10000,
      currency: 'BRL',
      itemsTotalCents: 4000,
      partnersTotalCents: 0,
      overflowCents: 0,
      shippingCents: 0,
      chargeCents: 0,
      autoSendOptIn: false,
      items: [
        {
          catalogItemId: 'ci_1',
          quantity: 2,
          unitPriceCents: 2000,
          subtotalCents: 4000,
          titleSnapshot: 'Adesivo',
          imageUrl: null,
          included: true,
          dropReason: null,
        },
      ],
      partnerItems: [],
    };
    expect(boxViewSchema.parse(view).items).toHaveLength(1);
  });

  it('rejects a selection update with negative quantity', () => {
    const bad = { items: [{ catalogItemId: 'ci_1', quantity: -1 }], partnerItems: [] };
    expect(() => boxSelectionUpdateSchema.parse(bad)).toThrow();
  });

  it('accepts a confirm payload with an address', () => {
    const parsed = boxConfirmSchema.parse({ shippingAddressId: 'addr_1' });
    expect(parsed.shippingAddressId).toBe('addr_1');
  });
});
