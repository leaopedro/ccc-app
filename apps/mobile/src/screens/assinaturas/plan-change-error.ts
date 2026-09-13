// Maps a failed POST /api/me/premium/plan onto something the member can act
// on.
//
// Mirrors checkout-error.ts. Status codes and bodies come from
// apps/api/src/routes/me-premium.ts (changePlanHandler) — see the guard order
// documented there: no live membership (404 NotFound) before provider (409
// NotStripeSubscription) before status (409 InvalidStatus), all before the
// catalog (404 PlanNotFound), then the annual-cadence/add-on combination
// check (422 PremiumCheckoutRejected), then NoChange from the billing layer.

import { ApiError } from '~/api/client';
import { assinaturasCopy } from '~/copy/assinaturas';

export type PlanChangeErrorReason =
  | 'not_stripe'
  | 'invalid_status'
  | 'no_change'
  | 'plan_not_found'
  | 'no_membership'
  | 'annual_addon'
  | 'unavailable'
  | 'rate_limited'
  | 'unauthorized'
  | 'generic';

export type PlanChangeError = {
  reason: PlanChangeErrorReason;
  message: string;
  /** Only set for `not_stripe`: an App Store manage-subscription link. */
  manageUrl?: string;
};

const body = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof ApiError)) return {};
  const b = error.body;
  return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {};
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

export function resolvePlanChangeError(error: unknown): PlanChangeError {
  const copy = assinaturasCopy.alterar;
  const b = body(error);
  const status = error instanceof ApiError ? error.status : 0;

  switch (status) {
    case 503:
      return { reason: 'unavailable', message: copy.errorUnavailable };
    case 409: {
      if (b.error === 'NotStripeSubscription') {
        return {
          reason: 'not_stripe',
          message: copy.appleBody,
          ...(str(b.manageUrl) ? { manageUrl: str(b.manageUrl) as string } : {}),
        };
      }
      if (b.error === 'InvalidStatus') {
        return { reason: 'invalid_status', message: copy.errorPastDue };
      }
      // NoChange is the last 409 the route can raise (from `changePlan`
      // itself, checked before any Stripe call).
      return { reason: 'no_change', message: copy.errorNoChange };
    }
    case 422: {
      // The real body is premiumCheckoutRejectionSchema: `error:
      // 'PremiumCheckoutRejected'`, `code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED'`
      // (packages/shared/src/premium.ts). A bare UnprocessableEntity (schema
      // validation) falls through to generic instead.
      if (b.error === 'PremiumCheckoutRejected' && b.code === 'ANNUAL_CADENCE_ADDON_UNSUPPORTED') {
        return { reason: 'annual_addon', message: copy.unavailableCadence };
      }
      return { reason: 'generic', message: copy.errorGeneric };
    }
    case 429:
      return { reason: 'rate_limited', message: copy.errorRateLimited };
    case 404:
      // `NotFound` (no live membership — no garage, or pickLiveMembership
      // found nothing) is a different fact from `PlanNotFound` (target plan
      // deactivated / no price for that cadence). The plan is fine in the
      // NotFound case; there is simply no subscription to change it on.
      // Collapsing them told the member the plan was the problem when it was
      // their own membership state.
      if (b.error === 'NotFound') {
        return { reason: 'no_membership', message: copy.errorNoMembership };
      }
      return { reason: 'plan_not_found', message: copy.errorPlanNotFound };
    case 401:
      return { reason: 'unauthorized', message: copy.errorUnauthorized };
    default:
      return { reason: 'generic', message: copy.errorGeneric };
  }
}
