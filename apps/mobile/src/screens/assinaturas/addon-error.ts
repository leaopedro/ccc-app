// Maps a failed POST /api/me/premium/addons or DELETE
// /api/me/premium/addons/:addonKey onto something the member can act on.
//
// Mirrors plan-change-error.ts. Status codes and bodies come from
// apps/api/src/routes/me-premium-addons.ts. `action` is a required
// parameter because a 404 means a different thing on each verb: on attach
// the module is missing from the catalog (ModuleNotFound); on detach the
// add-on simply isn't attached (AddonNotAttached).

import { ApiError } from '~/api/client';
import { assinaturasCopy } from '~/copy/assinaturas';

export type AddonErrorReason =
  | 'not_stripe'
  | 'invalid_status'
  | 'already_attached'
  | 'module_not_found'
  | 'not_attached'
  | 'unavailable'
  | 'rate_limited'
  | 'unauthorized'
  | 'generic';

export type AddonError = {
  reason: AddonErrorReason;
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

export function resolveAddonError(error: unknown, action: 'attach' | 'detach'): AddonError {
  const copy = assinaturasCopy.minhaAssinatura.modulos;
  const b = body(error);
  const status = error instanceof ApiError ? error.status : 0;

  switch (status) {
    case 503:
      return { reason: 'unavailable', message: copy.errorUnavailable };
    case 409: {
      if (b.error === 'NotStripeSubscription') {
        return {
          reason: 'not_stripe',
          message: copy.errorNotStripe,
          ...(str(b.manageUrl) ? { manageUrl: str(b.manageUrl) as string } : {}),
        };
      }
      // 409 InvalidStatus (attach only — the membership's status is outside
      // MEMBER_ADDON_ATTACH_STATUS). past_due is the reachable case today,
      // same fact `alterar.errorPastDue` already states — reused rather
      // than writing a variant.
      if (b.error === 'InvalidStatus') {
        return { reason: 'invalid_status', message: assinaturasCopy.alterar.errorPastDue };
      }
      // 409 AlreadyExists (attach only — AddonAlreadyAttached).
      if (b.error === 'AlreadyExists') {
        return { reason: 'already_attached', message: copy.errorAlreadyAttached };
      }
      return { reason: 'generic', message: copy.errorGeneric };
    }
    case 404:
      return action === 'attach'
        ? { reason: 'module_not_found', message: copy.errorModuleNotFound }
        : { reason: 'not_attached', message: copy.errorNotAttached };
    case 429:
      return { reason: 'rate_limited', message: copy.errorRateLimited };
    case 401:
      return { reason: 'unauthorized', message: copy.errorUnauthorized };
    default:
      return { reason: 'generic', message: copy.errorGeneric };
  }
}
