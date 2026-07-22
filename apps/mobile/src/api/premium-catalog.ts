// Premium catalog + subscription API helpers.
//
// Catalog reads (plans / addon modules) are PUBLIC — the catalog renders before
// sign-in, mirroring the store catalog. "My subscription" is authenticated.
// Endpoints: GET /api/plans, GET /api/plans/:slug, GET /api/addon-modules,
// GET /api/me/premium/subscription.

import {
  premiumAddonModuleListResponseSchema,
  premiumPlanListResponseSchema,
  premiumPlanSchema,
  type PremiumAddonModuleListResponse,
  type PremiumPlan,
  type PremiumPlanListResponse,
} from '@jdm/shared/premium-catalog';
import {
  mySubscriptionResponseSchema,
  type MySubscriptionResponse,
} from '@jdm/shared/premium-subscription';
import type { z } from 'zod';

import { authedRequest, request } from '~/api/client';

const planSchema = premiumPlanSchema as z.ZodType<PremiumPlan>;
const planListSchema = premiumPlanListResponseSchema as z.ZodType<PremiumPlanListResponse>;
const addonListSchema =
  premiumAddonModuleListResponseSchema as z.ZodType<PremiumAddonModuleListResponse>;
const subscriptionSchema = mySubscriptionResponseSchema as z.ZodType<MySubscriptionResponse>;

export const listPremiumPlans = (): Promise<PremiumPlanListResponse> =>
  request('/api/plans', planListSchema);

export const getPremiumPlan = (slug: string): Promise<PremiumPlan> =>
  request(`/api/plans/${encodeURIComponent(slug)}`, planSchema);

export const listPremiumAddonModules = (): Promise<PremiumAddonModuleListResponse> =>
  request('/api/addon-modules', addonListSchema);

export const getMyPremiumSubscription = (): Promise<MySubscriptionResponse> =>
  authedRequest('/api/me/premium/subscription', subscriptionSchema);
