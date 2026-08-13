import * as Sentry from '@sentry/node';

/**
 * Stripe raises `resource_missing` when an id belongs to the other mode — a
 * `cus_test_...` used under a live key, or vice versa. Production ran entirely
 * in test mode before the live cutover, so every row that survived the flip
 * without being purged can hit this.
 */
const isResourceMissing = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === 'resource_missing';

/**
 * Rethrows anything that is not a cross-mode reference error, so real Stripe
 * outages keep surfacing as 5xx. For a stale ref it alerts and returns, letting
 * the caller answer a typed 409.
 *
 * Why 409 and not 5xx: a stale ref is permanent. Retrying never fixes it, only
 * purging or re-provisioning the row does. Answering 5xx invites retries and, on
 * the routes that had no try/catch at all, produced an unhandled 500 that
 * repeated forever and locked the member out of ever subscribing again.
 */
export const handleStaleRef = (err: unknown, ref: string, where: string): void => {
  if (!isResourceMissing(err)) throw err;
  Sentry.captureMessage('stripe: stale cross-mode reference', {
    level: 'warning',
    tags: { kind: 'stripe-stale-ref', provider: 'stripe' },
    extra: { ref, where },
  });
};
