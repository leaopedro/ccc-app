// Shared buy-spot quick-confirm flow. Both /garage and /profile/garage host
// the same `GarageListView`; both buy-spot taps must route through the
// `BuySpotSheet` introduced in chunk 10. Centralizing here keeps the ref
// locks + cancel semantics in a single place.
//
// Locked-contract impact: the cart-add still goes through the same
// `POST /me/garage/spots/cart` → `/cart` pipeline. This hook only changes
// the entry surface (quick-confirm sheet) — payment + settlement remain
// untouched per §C10.

import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { addGarageSpotToCart, type GarageReadResponse } from '~/api/garage';
import { useCart } from '~/cart/context';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';

const formatPrice = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

export type BuySheetState = { priceLabel: string } | null;

export type UseBuySpotFlow = {
  buySheet: BuySheetState;
  submitting: boolean;
  openBuySheet: (garage: GarageReadResponse | null) => void;
  closeBuySheet: () => void;
  goCheckout: () => Promise<void>;
};

export function useBuySpotFlow(): UseBuySpotFlow {
  const router = useRouter();
  const { refresh } = useCart();
  const [buySheet, setBuySheet] = useState<BuySheetState>(null);
  const [submitting, setSubmitting] = useState(false);
  // User dismissed sheet while cart-add was in flight; skip the post-await
  // navigation but let the server-side cart-add resolve (idempotent — the
  // item is visible on next /cart focus).
  const cancelRef = useRef(false);
  // Synchronous lock for fast double-taps. The React `submitting` state
  // lags by a render; a ref set before the first await closes that window.
  const inFlightRef = useRef(false);

  const openBuySheet = useCallback((garage: GarageReadResponse | null) => {
    const priceCents = garage?.purchaseOption?.displayPriceCents;
    if (typeof priceCents !== 'number') return;
    cancelRef.current = false;
    setBuySheet({ priceLabel: formatPrice(priceCents) });
  }, []);

  const closeBuySheet = useCallback(() => {
    cancelRef.current = true;
    setBuySheet(null);
  }, []);

  const goCheckout = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      let cartItem: { cartId: string; itemId: string } | null = null;
      try {
        cartItem = await addGarageSpotToCart();
      } catch {
        showMessage(garageCopy.garage.buySpotFailed);
        return;
      }
      try {
        await refresh();
      } catch {
        // Cart state reconciles on next focus; non-blocking.
      }
      setBuySheet(null);
      if (cancelRef.current) return;
      // Phase 1 §C10 plumbing: future cart-success reads itemId to bounce
      // back to /garage?highlight=<spotId>; v1 cart ignores both keys.
      const url = cartItem
        ? `/cart?return=garage&itemId=${encodeURIComponent(cartItem.itemId)}`
        : '/cart';
      router.push(url as never);
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [router, refresh]);

  return { buySheet, submitting, openBuySheet, closeBuySheet, goCheckout };
}
