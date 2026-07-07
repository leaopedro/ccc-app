import type {
  BeginCheckoutRequest,
  BeginCheckoutResponse,
  CartItemInput,
  ClearCartResponse,
  GetCartResponse,
  UpsertCartItemResponse,
} from '@jdm/shared/cart';
import {
  beginCheckoutRequestSchema,
  beginCheckoutResponseSchema,
  cartItemInputSchema,
  clearCartResponseSchema,
  getCartResponseSchema,
  upsertCartItemResponseSchema,
} from '@jdm/shared/cart';

import { authedRequest } from './client';

export const getCart = (): Promise<GetCartResponse> => {
  return authedRequest('/cart', getCartResponseSchema);
};

export const upsertCartItem = (item: CartItemInput): Promise<UpsertCartItemResponse> => {
  return authedRequest('/cart/items', upsertCartItemResponseSchema, {
    method: 'POST',
    body: { item: cartItemInputSchema.parse(item) },
  });
};

export const updateCartItem = (
  itemId: string,
  item: CartItemInput,
): Promise<UpsertCartItemResponse> => {
  return authedRequest(`/cart/items/${encodeURIComponent(itemId)}`, upsertCartItemResponseSchema, {
    method: 'PATCH',
    body: { item: cartItemInputSchema.parse(item) },
  });
};

export const removeCartItem = (itemId: string): Promise<ClearCartResponse> => {
  return authedRequest(`/cart/items/${encodeURIComponent(itemId)}`, clearCartResponseSchema, {
    method: 'DELETE',
  });
};

export const clearCart = (): Promise<ClearCartResponse> => {
  return authedRequest('/cart', clearCartResponseSchema, { method: 'DELETE' });
};

export const beginCheckout = (input: BeginCheckoutRequest): Promise<BeginCheckoutResponse> => {
  return authedRequest('/cart/checkout', beginCheckoutResponseSchema, {
    method: 'POST',
    body: beginCheckoutRequestSchema.parse(input),
  });
};
