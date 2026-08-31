// F8.18 — premium status API helper.
// Consumes GET /api/me/premium/status (spec §8.3 / chunk F8.11).
// premiumStatusSchema is defined in packages/shared/src/premium.ts (F8.11).

import {
  premiumCheckoutResponseSchema,
  premiumNativeCheckoutResponseSchema,
  premiumStatusSchema,
  type PremiumCheckoutResponse,
  type PremiumNativeCheckoutResponse,
} from '@ccc/shared/premium';
import { z } from 'zod';

import { authedRequest } from '~/api/client';

export type PremiumStatusResponse = z.infer<typeof premiumStatusSchema>;

export const getPremiumStatus = (): Promise<PremiumStatusResponse> =>
  authedRequest('/api/me/premium/status', premiumStatusSchema);

/** POST /api/me/premium/checkout — server resolves every price from the catalog. */
export const createPremiumCheckout = (input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<PremiumCheckoutResponse> =>
  authedRequest('/api/me/premium/checkout', premiumCheckoutResponseSchema, {
    method: 'POST',
    body: { cadence: 'monthly', planSlug: input.planSlug, addonKeys: input.addonKeys },
  });

/**
 * POST /api/me/premium/checkout-native — server creates the Stripe
 * subscription with `payment_behavior: 'default_incomplete'` and returns the
 * first invoice's client secret for the PaymentSheet to confirm. Membership
 * activation still comes only from the `invoice.paid` webhook.
 */
export const createPremiumSubscriptionNative = (input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<PremiumNativeCheckoutResponse> =>
  authedRequest('/api/me/premium/checkout-native', premiumNativeCheckoutResponseSchema, {
    method: 'POST',
    body: { cadence: 'monthly', planSlug: input.planSlug, addonKeys: input.addonKeys },
  });

/**
 * 409 body when POST /api/me/premium/cancel targets an Apple/RevenueCat
 * membership (no Stripe subscription to schedule cancellation on).
 */
export type CancelNotStripeSubscription = {
  error: 'NotStripeSubscription';
  provider: 'stripe' | 'apple_revenuecat';
  manageUrl: string;
};

/** POST /api/me/premium/cancel — schedules cancellation at period end. */
export const cancelPremiumSubscription = (): Promise<{
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string;
}> =>
  authedRequest(
    '/api/me/premium/cancel',
    z.object({ cancelAtPeriodEnd: z.boolean(), currentPeriodEnd: z.string() }),
    { method: 'POST' },
  );
