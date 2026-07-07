import { describe, expect, it } from 'vitest';

import type { CartState } from './reducer';
import { initialState, reducer } from './reducer';

const mockCart = {
  id: 'cart-1',
  userId: 'user-1',
  status: 'open' as const,
  items: [
    {
      id: 'item-1',
      eventId: 'evt-1',
      tierId: 'tier-1',
      variantId: null,
      source: 'purchase' as const,
      kind: 'ticket' as const,
      quantity: 1,
      requiresCar: false,
      tickets: [{ extras: [] as string[] }],
      extras: [],
      product: null,
      amountCents: 5000,
      currency: 'BRL',
      reservationExpiresAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  totals: {
    ticketSubtotalCents: 5000,
    extrasSubtotalCents: 0,
    productsSubtotalCents: 0,
    shippingSubtotalCents: 0,
    discountCents: 0,
    baseAmountCents: 5000,
    devFeePercent: 10,
    devFeeAmountCents: 500,
    amountCents: 5500,
    currency: 'BRL',
  },
  availableFulfillmentMethods: [],
  version: 1,
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('cart reducer', () => {
  it('FETCH_OK clears adding flag (removeItem path)', () => {
    const mutating: CartState = {
      ...initialState,
      adding: true,
    };

    const next = reducer(mutating, {
      type: 'FETCH_OK',
      cart: mockCart,
      stockWarnings: [],
      evictedItems: [],
    });

    expect(next.adding).toBe(false);
    expect(next.loading).toBe(false);
    expect(next.cart).toBe(mockCart);
  });

  it('MUTATE_START sets adding=true and clears error', () => {
    const withError: CartState = { ...initialState, error: 'add' };
    const next = reducer(withError, { type: 'MUTATE_START' });

    expect(next.adding).toBe(true);
    expect(next.error).toBeNull();
  });

  it('MUTATE_OK clears adding and sets cart', () => {
    const mutating: CartState = { ...initialState, adding: true };
    const next = reducer(mutating, { type: 'MUTATE_OK', cart: mockCart });

    expect(next.adding).toBe(false);
    expect(next.cart).toBe(mockCart);
  });

  it('MUTATE_ERROR clears adding without overwriting cart load state', () => {
    const mutating: CartState = { ...initialState, adding: true };
    const next = reducer(mutating, { type: 'MUTATE_ERROR', error: 'remove' });

    expect(next.adding).toBe(false);
    expect(next.error).toBeNull();
  });

  it('full removeItem flow: MUTATE_START → FETCH_OK resets adding', () => {
    let state = reducer(initialState, { type: 'MUTATE_START' });
    expect(state.adding).toBe(true);

    state = reducer(state, {
      type: 'FETCH_OK',
      cart: mockCart,
      stockWarnings: [],
      evictedItems: [],
    });
    expect(state.adding).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.cart).toBe(mockCart);
  });

  it('CLEAR_OK resets to initial state', () => {
    const withCart: CartState = { ...initialState, cart: mockCart, adding: true };
    const next = reducer(withCart, { type: 'CLEAR_OK' });

    expect(next).toEqual(initialState);
  });

  it('RESET resets to initial state', () => {
    const withCart: CartState = { ...initialState, cart: mockCart, adding: true };
    const next = reducer(withCart, { type: 'RESET' });

    expect(next).toEqual(initialState);
  });
});
