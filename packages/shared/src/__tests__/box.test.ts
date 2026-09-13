import { describe, expect, it } from 'vitest';

import {
  boxConfirmSchema,
  boxFulfillmentStatusSchema,
  boxSelectionUpdateSchema,
  boxViewSchema,
  boxCheckoutResponseSchema,
  boxCheckoutRequestSchema,
  meetsMinTier,
} from '../box.js';

describe('box shared schemas', () => {
  it('parses a full box view', () => {
    const view = {
      id: 'box_1',
      status: 'open',
      fulfillmentStatus: 'unfulfilled',
      cycleKey: '2026-08-01',
      cutoffAt: '2026-08-27T00:00:00.000Z',
      budgetCents: 10000,
      currency: 'BRL',
      itemsTotalCents: 4000,
      partnersTotalCents: 0,
      overflowCents: 0,
      shippingCents: 0,
      chargeCents: 0,
      orderId: null,
      autoSendOptIn: false,
      shippingAddressId: null,
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

  it('parses a box view carrying an orderId', () => {
    const parsed = boxViewSchema.parse({
      id: 'box_1',
      status: 'awaiting_payment',
      fulfillmentStatus: 'unfulfilled',
      cycleKey: '2026-08-01',
      cutoffAt: '2026-08-27T00:00:00.000Z',
      budgetCents: 10000,
      currency: 'BRL',
      itemsTotalCents: 12000,
      partnersTotalCents: 0,
      overflowCents: 2000,
      shippingCents: 0,
      chargeCents: 2000,
      orderId: 'ord_1',
      autoSendOptIn: false,
      shippingAddressId: 'addr_1',
      items: [],
      partnerItems: [],
    });
    expect(parsed.orderId).toBe('ord_1');
  });

  it('defaults orderId to null and parses a checkout response', () => {
    const view = boxViewSchema.parse({
      id: 'box_1',
      status: 'open',
      fulfillmentStatus: 'unfulfilled',
      cycleKey: '2026-08-01',
      cutoffAt: '2026-08-27T00:00:00.000Z',
      budgetCents: 10000,
      currency: 'BRL',
      itemsTotalCents: 0,
      partnersTotalCents: 0,
      overflowCents: 0,
      shippingCents: 0,
      chargeCents: 0,
      orderId: null,
      autoSendOptIn: false,
      shippingAddressId: null,
      items: [],
      partnerItems: [],
    });
    expect(view.orderId).toBeNull();
    const res = boxCheckoutResponseSchema.parse({
      method: 'pix',
      brCode: '00020126...',
      amountCents: 2000,
      expiresAt: '2026-08-27T00:00:00.000Z',
    });
    if (res.method === 'pix') expect(res.brCode).toContain('000201');
  });

  it('exposes the 5-value box fulfillment enum and requires it on the view', () => {
    expect(boxFulfillmentStatusSchema.options).toEqual([
      'unfulfilled',
      'packed',
      'shipped',
      'delivered',
      'cancelled',
    ]);
    const missing = {
      id: 'box_1',
      status: 'ready',
      cycleKey: '2026-08-01',
      cutoffAt: '2026-08-27T00:00:00.000Z',
      budgetCents: 10000,
      currency: 'BRL',
      itemsTotalCents: 0,
      partnersTotalCents: 0,
      overflowCents: 0,
      shippingCents: 0,
      chargeCents: 0,
      orderId: null,
      autoSendOptIn: false,
      shippingAddressId: null,
      items: [],
      partnerItems: [],
    };
    expect(() => boxViewSchema.parse(missing)).toThrow();
  });

  it('parses a pix checkout response', () => {
    const parsed = boxCheckoutResponseSchema.parse({
      method: 'pix',
      brCode: '00020126-BR',
      amountCents: 2000,
      expiresAt: '2026-09-20T00:00:00.000Z',
    });
    expect(parsed.method).toBe('pix');
    if (parsed.method === 'pix') expect(parsed.brCode).toBe('00020126-BR');
  });

  it('parses a card checkout response', () => {
    const parsed = boxCheckoutResponseSchema.parse({
      method: 'card',
      clientSecret: 'pi_1_secret_abc',
      amountCents: 2000,
      expiresAt: '2026-09-20T00:00:00.000Z',
    });
    expect(parsed.method).toBe('card');
    if (parsed.method === 'card') expect(parsed.clientSecret).toBe('pi_1_secret_abc');
  });

  it('rejects a pix response missing the brCode', () => {
    expect(() =>
      boxCheckoutResponseSchema.parse({
        method: 'pix',
        amountCents: 2000,
        expiresAt: '2026-09-20T00:00:00.000Z',
      }),
    ).toThrow();
  });

  // Direcao perigosa: app novo contra API velha. O teste nao conserta nada, so
  // documenta que a unica protecao e a ordem de deploy.
  it('rejects a legacy response with no method (deploy order matters)', () => {
    expect(() =>
      boxCheckoutResponseSchema.parse({
        brCode: '00020126-BR',
        amountCents: 2000,
        expiresAt: '2026-09-20T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('defaults the checkout request method to pix', () => {
    expect(boxCheckoutRequestSchema.parse({}).method).toBe('pix');
  });

  it('rejects an unknown checkout request method', () => {
    expect(() => boxCheckoutRequestSchema.parse({ method: 'boleto' })).toThrow();
  });
});

describe('meetsMinTier', () => {
  it('null minTier is always satisfied', () => {
    expect(meetsMinTier('bronze', null)).toBe(true);
    expect(meetsMinTier('gold', null)).toBe(true);
  });
  it('enforces hierarchy bronze < silver < gold', () => {
    expect(meetsMinTier('bronze', 'silver')).toBe(false);
    expect(meetsMinTier('silver', 'silver')).toBe(true);
    expect(meetsMinTier('gold', 'silver')).toBe(true);
    expect(meetsMinTier('silver', 'gold')).toBe(false);
    expect(meetsMinTier('bronze', 'bronze')).toBe(true);
  });
});
