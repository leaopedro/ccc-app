'use server';

import { z } from 'zod';

import { apiFetch } from '~/lib/api';

// `PremiumCadence` is not exported from `@jdm/shared/premium`; use a local
// alias matching the cadence enum used by premiumCheckoutRequestSchema there.
type PremiumCadence = 'monthly' | 'annual';

const checkoutResponseSchema = z.object({ url: z.string().url() });

/**
 * Mints a Stripe Checkout session for the given cadence.
 * Returns the hosted Checkout URL to redirect the browser to.
 * Throws ApiError on failure (caller must handle).
 *
 * Feature flag: if GROWTH_PREMIUM_BILLING_ENABLED is off the API returns 503;
 * apiFetch throws ApiError(503, ...) — let it propagate.
 */
export async function subscribeAction(cadence: PremiumCadence): Promise<string> {
  const data = await apiFetch('/api/me/premium/checkout', {
    method: 'POST',
    body: JSON.stringify({ cadence }),
    schema: checkoutResponseSchema,
  });
  return data.url;
}
