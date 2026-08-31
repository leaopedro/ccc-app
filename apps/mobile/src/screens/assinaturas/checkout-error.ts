// Maps a failed POST /api/me/premium/checkout onto something the member can act
// on.
//
// Why this exists: the screen used to render one sentence for every failure.
// 503 (billing off, plan price missing, add-on price missing), 409
// (AlreadySubscribed, StaleBillingReference), 403 (incomplete profile), 429,
// 404 and 422 all read as "Não foi possível iniciar o pagamento. Tente
// novamente." Two of those are actionable and one of them ships a `manageUrl`
// that was thrown away. Retrying is the wrong advice for most of them.
//
// Mirrors the shape of ~/cart/error-message.ts, which already does this for the
// cart. Status codes and bodies come from apps/api/src/routes/me-premium.ts.

import { ApiError } from '~/api/client';
import { assinaturasCopy } from '~/copy/assinaturas';

export type CheckoutErrorReason =
  | 'unavailable'
  | 'addon_unavailable'
  | 'already_subscribed'
  | 'attempt_in_flight'
  | 'stale_billing'
  | 'incomplete_profile'
  | 'rate_limited'
  | 'plan_not_found'
  | 'unauthorized'
  | 'generic';

export type CheckoutError = {
  reason: CheckoutErrorReason;
  message: string;
  /** Only set for `already_subscribed`: a Stripe portal or App Store link. */
  manageUrl?: string;
};

const body = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof ApiError)) return {};
  const b = error.body;
  return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {};
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * True when the failure is about a selected module rather than the plan. Both
 * arrive as a bare `ServiceUnavailable`/`BadRequest`, so the key list is the
 * only discriminator, and it is what tells the member to drop a module instead
 * of coming back later.
 */
const isAddonProblem = (b: Record<string, unknown>): boolean =>
  Array.isArray(b.missingAddonKeys) || Array.isArray(b.unknownAddonKeys);

export function resolveCheckoutError(error: unknown): CheckoutError {
  const copy = assinaturasCopy.contratar;
  const b = body(error);
  const status = error instanceof ApiError ? error.status : 0;

  if (isAddonProblem(b)) {
    return { reason: 'addon_unavailable', message: copy.errorAddon };
  }

  switch (status) {
    case 503:
      return { reason: 'unavailable', message: copy.errorUnavailable };
    case 409: {
      if (b.error === 'StaleBillingReference') {
        return { reason: 'stale_billing', message: copy.errorStaleBilling };
      }
      // A conflicting attempt already running (a pending native attempt or an
      // open hosted Checkout Session) is not the same fact as "you already
      // subscribe" — the member has no active subscription to manage, so
      // `manageUrl` (kept only on `already_subscribed`) would point nowhere
      // useful here.
      if (b.error === 'SubscriptionAttemptInFlight') {
        return { reason: 'attempt_in_flight', message: copy.errorAttemptInFlight };
      }
      return {
        reason: 'already_subscribed',
        message: copy.errorAlreadySubscribed,
        ...(str(b.manageUrl) ? { manageUrl: str(b.manageUrl) as string } : {}),
      };
    }
    case 429:
      return { reason: 'rate_limited', message: copy.errorRateLimited };
    case 403:
      return { reason: 'incomplete_profile', message: copy.errorIncompleteProfile };
    case 404:
      return { reason: 'plan_not_found', message: copy.errorPlanNotFound };
    case 401:
      return { reason: 'unauthorized', message: copy.errorUnauthorized };
    default:
      return { reason: 'generic', message: copy.errorGeneric };
  }
}
