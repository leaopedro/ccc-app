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

export const listPremiumPlans = (): Promise<PremiumPlanListResponse> =>
  request('/api/plans', planListSchema);

export const getPremiumPlan = async (slug: string): Promise<PremiumPlanDetailResponse> =>
  request(`/api/plans/${encodeURIComponent(slug)}`, premiumPlanDetailResponseSchema);

export const listPremiumAddonModules = (): Promise<PremiumAddonModuleListResponse> =>
  request('/api/addon-modules', addonListSchema);

export const getMyPremiumSubscription = (): Promise<MySubscriptionResponse> =>
  authedRequest('/api/me/premium/subscription', subscriptionSchema);

export const listPremiumInvoices = (): Promise<PremiumInvoicesResponse> =>
  authedRequest('/api/me/premium/invoices', invoicesSchema);
