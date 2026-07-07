import type { CartItemInput } from '@jdm/shared/cart';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import type { CartState } from './reducer';
import { initialState, reducer } from './reducer';

import * as cartApi from '~/api/cart';
import { useAuth } from '~/auth/context';

type CartContextValue = CartState & {
  itemCount: number;
  refresh: () => Promise<void>;
  addItem: (item: CartItemInput) => Promise<void>;
  removeItem: (itemId: string) => Promise<boolean>;
  clear: () => Promise<boolean>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);

  const fetchCart = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const res = await cartApi.getCart();
      dispatch({
        type: 'FETCH_OK',
        cart: res.cart,
        stockWarnings: res.stockWarnings,
        evictedItems: res.evictedItems,
      });
    } catch {
      dispatch({ type: 'FETCH_ERROR', error: 'load' });
    }
  }, []);

  useEffect(() => {
    if (auth.status === 'authenticated') {
      void fetchCart();
    } else {
      dispatch({ type: 'RESET' });
    }
  }, [auth.status, fetchCart]);

  const addItem = useCallback(async (item: CartItemInput): Promise<void> => {
    dispatch({ type: 'MUTATE_START' });
    try {
      const res = await cartApi.upsertCartItem(item);
      dispatch({ type: 'MUTATE_OK', cart: res.cart });
    } catch (error: unknown) {
      dispatch({ type: 'MUTATE_ERROR', error: 'add' });
      throw error;
    }
  }, []);

  const removeItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      dispatch({ type: 'MUTATE_START' });
      try {
        await cartApi.removeCartItem(itemId);
        await fetchCart();
        return true;
      } catch {
        dispatch({ type: 'MUTATE_ERROR', error: 'remove' });
        return false;
      }
    },
    [fetchCart],
  );

  const clear = useCallback(async (): Promise<boolean> => {
    dispatch({ type: 'MUTATE_START' });
    try {
      await cartApi.clearCart();
      dispatch({ type: 'CLEAR_OK' });
      return true;
    } catch {
      dispatch({ type: 'MUTATE_ERROR', error: 'clear' });
      return false;
    }
  }, []);

  const itemCount = useMemo(() => {
    if (!state.cart) return 0;
    return state.cart.items.reduce((sum, i) => sum + i.quantity, 0);
  }, [state.cart]);

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      itemCount,
      refresh: fetchCart,
      addItem,
      removeItem,
      clear,
    }),
    [state, itemCount, fetchCart, addItem, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
