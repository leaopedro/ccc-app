// Premium catalog + subscription API helpers.
//
// Catalog reads (plans / addon modules) are PUBLIC — the catalog renders before
// sign-in, mirroring the store catalog. "My subscription" is authenticated.
// Endpoints: GET /api/plans, GET /api/plans/:slug, GET /api/addon-modules,
// GET /api/me/premium/subscription.

import {
  premiumAddonModuleListResponseSchema,
  premiumPlanDetailResponseSchema,
  premiumPlanListResponseSchema,
  type PremiumAddonModuleListResponse,
  type PremiumPlanDetailResponse,
  type PremiumPlanListResponse,
} from '@ccc/shared/premium-catalog';
import {
  mySubscriptionResponseSchema,
  premiumInvoicesResponseSchema,
  type MySubscriptionResponse,
  type PremiumInvoicesResponse,
} from '@ccc/shared/premium-subscription';
import type { z } from 'zod';

import { authedRequest, request } from '~/api/client';

const planListSchema = premiumPlanListResponseSchema as z.ZodType<PremiumPlanListResponse>;
const addonListSchema =
  premiumAddonModuleListResponseSchema as z.ZodType<PremiumAddonModuleListResponse>;
const subscriptionSchema = mySubscriptionResponseSchema as z.ZodType<MySubscriptionResponse>;
const invoicesSchema = premiumInvoicesResponseSchema as z.ZodType<PremiumInvoicesResponse>;

// The platform gate (`subscriptionsEnabled`) rides on every catalog response
// and does not change within a session, so the last value observed from ANY
// of the three calls below is cached here. Consumers that only need the
// boolean — e.g. a future hook deciding whether the premium tab slot offers
// subscriptions at all — can read `peekSubscriptionsEnabled()` /
// `getSubscriptionsEnabledCached()` instead of driving their own catalog
// fetch, so they never duplicate a network request just to learn the gate.
let cachedSubscriptionsEnabled: boolean | null = null;
let inFlightGate: Promise<boolean> | null = null;

function cacheSubscriptionsEnabled(value: boolean): boolean {
  cachedSubscriptionsEnabled = value;
  return value;
}

export const listPremiumPlans = (): Promise<PremiumPlanListResponse> =>
  request('/api/plans', planListSchema).then((response) => {
    cacheSubscriptionsEnabled(response.subscriptionsEnabled);
    return response;
  });

export const getPremiumPlan = async (slug: string): Promise<PremiumPlanDetailResponse> => {
  const response = await request(
    `/api/plans/${encodeURIComponent(slug)}`,
    premiumPlanDetailResponseSchema,
  );
  cacheSubscriptionsEnabled(response.subscriptionsEnabled);
  return response;
};

export const listPremiumAddonModules = (): Promise<PremiumAddonModuleListResponse> =>
  request('/api/addon-modules', addonListSchema).then((response) => {
    cacheSubscriptionsEnabled(response.subscriptionsEnabled);
    return response;
  });

/** Synchronous read of the last-observed gate value; `null` = not fetched yet this session. */
export const peekSubscriptionsEnabled = (): boolean | null => cachedSubscriptionsEnabled;

/**
 * Cheap async read of the platform gate. Returns the cached value if any
 * catalog call has already resolved this session; otherwise makes exactly
 * one shared `/api/plans` request (de-duped against concurrent callers) to
 * find out.
 */
export const getSubscriptionsEnabledCached = (): Promise<boolean> => {
  if (cachedSubscriptionsEnabled !== null) return Promise.resolve(cachedSubscriptionsEnabled);
  if (!inFlightGate) {
    inFlightGate = listPremiumPlans()
      .then((response) => response.subscriptionsEnabled)
      .finally(() => {
        inFlightGate = null;
      });
  }
  return inFlightGate;
};

export const getMyPremiumSubscription = (): Promise<MySubscriptionResponse> =>
  authedRequest('/api/me/premium/subscription', subscriptionSchema);

export const listPremiumInvoices = (): Promise<PremiumInvoicesResponse> =>
  authedRequest('/api/me/premium/invoices', invoicesSchema);
