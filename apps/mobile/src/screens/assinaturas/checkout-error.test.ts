import { describe, expect, it, vi } from 'vitest';

// `~/api/client` reads expo-constants at module load, which pulls react-native
// into a plain node run. Same stub the cart mapper test uses.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { ApiError } = await import('~/api/client');
const { resolveCheckoutError } = await import('./checkout-error');

const err = (status: number, body: unknown) => new ApiError(status, 'request failed', body);

describe('resolveCheckoutError', () => {
  it('maps 503 billing-off to the unavailable reason', () => {
    const out = resolveCheckoutError(
      err(503, { error: 'ServiceUnavailable', message: 'premium billing not available' }),
    );
    expect(out.reason).toBe('unavailable');
    expect(out.manageUrl).toBeUndefined();
  });

  it('maps a 503 carrying missingAddonKeys to the add-on reason, not the generic one', () => {
    // Same status and same `error` as billing-off; only missingAddonKeys tells
    // the member the fix is to drop a module rather than to come back later.
    const out = resolveCheckoutError(
      err(503, {
        error: 'ServiceUnavailable',
        message: 'add-on price not configured',
        missingAddonKeys: ['wash-01'],
      }),
    );
    expect(out.reason).toBe('addon_unavailable');
  });

  it('keeps the manageUrl from a 409 AlreadySubscribed', () => {
    const out = resolveCheckoutError(
      err(409, {
        error: 'AlreadySubscribed',
        provider: 'stripe',
        manageUrl: 'https://billing.stripe.com/session/abc',
      }),
    );
    expect(out.reason).toBe('already_subscribed');
    expect(out.manageUrl).toBe('https://billing.stripe.com/session/abc');
  });

  it('separates StaleBillingReference from AlreadySubscribed on the same status', () => {
    const out = resolveCheckoutError(err(409, { error: 'StaleBillingReference' }));
    expect(out.reason).toBe('stale_billing');
    expect(out.manageUrl).toBeUndefined();
  });

  it('maps 429 to rate_limited so the member is told to wait', () => {
    expect(resolveCheckoutError(err(429, { error: 'Error' })).reason).toBe('rate_limited');
  });

  it('maps 403 to incomplete_profile', () => {
    expect(resolveCheckoutError(err(403, { error: 'INCOMPLETE_PROFILE' })).reason).toBe(
      'incomplete_profile',
    );
  });

  it('maps 404 to plan_not_found', () => {
    expect(resolveCheckoutError(err(404, { error: 'NotFound' })).reason).toBe('plan_not_found');
  });

  it('maps 400 unknown add-on key to the add-on reason', () => {
    expect(
      resolveCheckoutError(
        err(400, { error: 'BadRequest', message: 'unknown add-on key', unknownAddonKeys: ['x'] }),
      ).reason,
    ).toBe('addon_unavailable');
  });

  it('falls back to generic for a non-ApiError', () => {
    const out = resolveCheckoutError(new Error('boom'));
    expect(out.reason).toBe('generic');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('gives every reason a non-empty message', () => {
    const cases: unknown[] = [
      err(503, { error: 'ServiceUnavailable' }),
      err(503, { error: 'ServiceUnavailable', missingAddonKeys: ['a'] }),
      err(409, { error: 'AlreadySubscribed', manageUrl: 'https://x.test' }),
      err(409, { error: 'StaleBillingReference' }),
      err(429, {}),
      err(403, {}),
      err(404, {}),
      err(401, {}),
      err(422, {}),
      new Error('boom'),
    ];
    for (const c of cases) {
      expect(resolveCheckoutError(c).message.trim().length).toBeGreaterThan(0);
    }
  });
});
