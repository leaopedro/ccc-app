import { describe, expect, it } from 'vitest';

import {
  beginCheckoutRequestSchema,
  cartItemProductSchema,
  cartSchema,
  fulfillmentMethodSchema,
} from '../src/cart.js';

describe('fulfillmentMethodSchema', () => {
  it('accepts pickup and ship', () => {
    expect(fulfillmentMethodSchema.parse('pickup')).toBe('pickup');
    expect(fulfillmentMethodSchema.parse('ship')).toBe('ship');
  });

  it('rejects unknown values', () => {
    expect(() => fulfillmentMethodSchema.parse('mail')).toThrow();
  });
});

describe('cartItemProductSchema', () => {
  it('parses canShip + canPickup capability flags', () => {
    const product = cartItemProductSchema.parse({
      productId: 'prod_1',
      productTitle: 'Camiseta',
      productSlug: 'camiseta',
      variantId: 'var_1',
      variantName: 'Preta / M',
      variantSku: 'SKU-1',
      unitPriceCents: 9900,
      canShip: true,
      canPickup: true,
      shippingFeeCents: 1000,
      attributes: null,
    });
    expect(product.canShip).toBe(true);
    expect(product.canPickup).toBe(true);
  });
});

describe('cartSchema availableFulfillmentMethods', () => {
  it('parses an empty array', () => {
    const cart = cartSchema.parse({
      id: 'cart_1',
      userId: 'usr_1',
      status: 'open',
      items: [],
      totals: {
        ticketSubtotalCents: 0,
        extrasSubtotalCents: 0,
        productsSubtotalCents: 0,
        shippingSubtotalCents: 0,
        discountCents: 0,
        baseAmountCents: 0,
        devFeePercent: 10,
        devFeeAmountCents: 0,
        amountCents: 0,
        currency: 'BRL',
      },
      availableFulfillmentMethods: [],
      version: 1,
      expiresAt: null,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
    });
    expect(cart.availableFulfillmentMethods).toEqual([]);
  });

  it('parses pickup + ship together', () => {
    const cart = cartSchema.parse({
      id: 'cart_1',
      userId: 'usr_1',
      status: 'open',
      items: [],
      totals: {
        ticketSubtotalCents: 0,
        extrasSubtotalCents: 0,
        productsSubtotalCents: 0,
        shippingSubtotalCents: 0,
        discountCents: 0,
        baseAmountCents: 0,
        devFeePercent: 10,
        devFeeAmountCents: 0,
        amountCents: 0,
        currency: 'BRL',
      },
      availableFulfillmentMethods: ['pickup', 'ship'],
      version: 1,
      expiresAt: null,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
    });
    expect(cart.availableFulfillmentMethods).toEqual(['pickup', 'ship']);
  });
});

describe('beginCheckoutRequestSchema fulfillmentMethod', () => {
  it('accepts request without fulfillmentMethod', () => {
    expect(() =>
      beginCheckoutRequestSchema.parse({
        paymentMethod: 'card',
      }),
    ).not.toThrow();
  });

  it('accepts request with fulfillmentMethod', () => {
    const parsed = beginCheckoutRequestSchema.parse({
      paymentMethod: 'card',
      fulfillmentMethod: 'pickup',
      pickupEventId: 'evt_1',
    });
    expect(parsed.fulfillmentMethod).toBe('pickup');
  });
});
