import type { Cart, CartStockWarning, EvictedCartItem } from '@jdm/shared/cart';

export type CartState = {
  cart: Cart | null;
  loading: boolean;
  error: string | null;
  adding: boolean;
  stockWarnings: CartStockWarning[];
  evictedItems: EvictedCartItem[];
};

export type CartAction =
  | { type: 'FETCH_START' }
  | {
      type: 'FETCH_OK';
      cart: Cart | null;
      stockWarnings: CartStockWarning[];
      evictedItems: EvictedCartItem[];
    }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'MUTATE_START' }
  | { type: 'MUTATE_OK'; cart: Cart }
  | { type: 'MUTATE_ERROR'; error: string }
  | { type: 'CLEAR_OK' }
  | { type: 'RESET' };

export const initialState: CartState = {
  cart: null,
  loading: false,
  error: null,
  adding: false,
  stockWarnings: [],
  evictedItems: [],
};

export function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_OK':
      return {
        ...state,
        loading: false,
        adding: false,
        cart: action.cart,
        stockWarnings: action.stockWarnings,
        evictedItems: action.evictedItems,
      };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'MUTATE_START':
      return { ...state, adding: true, error: null };
    case 'MUTATE_OK':
      return { ...state, adding: false, cart: action.cart, stockWarnings: [], evictedItems: [] };
    case 'MUTATE_ERROR':
      return { ...state, adding: false };
    case 'CLEAR_OK':
      return { ...initialState };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}
