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
import {
  addonMutationResponseSchema,
  type AddonMutationResponse,
} from '@ccc/shared/premium-subscription';
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

/**
 * POST /api/me/premium/plan — switches the subscription's plan/cadence, with
 * proration (create_prorations). Answers `pending: true` on purpose: only the
 * verified webhook writes tier/cadence, so the caller must poll
 * (`pollSubscriptionTier`) before showing success.
 */
export const changePremiumPlan = (input: {
  planSlug: string;
  cadence: 'monthly' | 'annual';
}): Promise<{ ok: boolean; pending: boolean }> =>
  authedRequest('/api/me/premium/plan', z.object({ ok: z.boolean(), pending: z.boolean() }), {
    method: 'POST',
    body: { planSlug: input.planSlug, cadence: input.cadence },
  });

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

/**
 * POST /api/me/premium/addons — attach an add-on module by key. Also the
 * re-vínculo path: a `cancel_scheduled` (or `cancelled`) row on the caller's
 * own membership goes back to `active` instead of erroring, which is what
 * makes REATIVAR possible on Minha Assinatura.
 */
export const attachPremiumAddon = (addonKey: string): Promise<AddonMutationResponse> =>
  authedRequest('/api/me/premium/addons', addonMutationResponseSchema, {
    method: 'POST',
    body: { addonKey },
  });

/**
 * DELETE /api/me/premium/addons/:addonKey — schedules the add-on's
 * cancellation (never a hard delete). The response's recomputed totals are
 * NOT applied to local state by callers — only `usePremiumSubscription`'s
 * `refresh()` carries the add-on's current-cycle usage.
 */
export const detachPremiumAddon = (addonKey: string): Promise<AddonMutationResponse> =>
  authedRequest(
    `/api/me/premium/addons/${encodeURIComponent(addonKey)}`,
    addonMutationResponseSchema,
    { method: 'DELETE' },
  );
