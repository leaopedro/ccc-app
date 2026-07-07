import { brand } from '@jdm/design';

import { setPendingCheckoutUrl } from './web-pending-checkout';

const PENDING_ORDER_ID_KEY = `${brand.app.storagePrefix}:pendingOrderId`;

export interface RedirectToStripeCheckoutInput {
  checkoutUrl: string;
  orderIds: readonly string[];
  storage?: Storage | null;
  navigate?: (url: string) => void;
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function defaultNavigate(url: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = url;
}

export function redirectToStripeCheckout(input: RedirectToStripeCheckoutInput): void {
  const storage = input.storage === undefined ? defaultStorage() : input.storage;
  const navigate = input.navigate ?? defaultNavigate;

  // A multi-order cart maps to a single Stripe Checkout Session covering
  // the full cart. We persist the hosted URL only against the first
  // (canonical) order id, matching the existing `jdm:pendingOrderId`
  // convention. Storing the same URL against sibling orders would let
  // any sibling reopen the shared Stripe session and pay for the entire
  // cart even after sibling-level local cancellations.
  const firstOrderId = input.orderIds[0];
  if (firstOrderId && storage) {
    storage.setItem(PENDING_ORDER_ID_KEY, firstOrderId);
    setPendingCheckoutUrl(firstOrderId, input.checkoutUrl, { storage });
  }

  navigate(input.checkoutUrl);
}
