// Shared post-payment poller for the two checkout return paths (Android deep
// link inside ContratarScreen, and the web checkout-return route).
//
// The webhook is asynchronous — a closed browser does not prove payment. Poll
// until the membership flips active. Cadence mirrors
// app/(app)/events/buy/checkout-return.tsx.

import { getMyPremiumSubscription } from '~/api/premium-catalog';

export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_ATTEMPTS = 15;

/** Resolves true once the subscription is active, false when the attempts run out. */
export async function pollSubscriptionActive(): Promise<boolean> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const sub = await getMyPremiumSubscription();
      if (sub.active) return true;
    } catch {
      // Transient failure — keep polling; the caller shows the pending state.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
