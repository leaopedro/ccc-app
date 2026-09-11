import { describe, expect, it, vi } from 'vitest';

// `~/api/client` imports react-native directly (for the x-ccc-platform
// header) and reads expo-constants at module load, which also pulls
// react-native into a plain node run. Same stub checkout-error.test.ts uses.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { ApiError } = await import('~/api/client');
const { resolvePlanChangeError } = await import('./plan-change-error');
const { assinaturasCopy } = await import('~/copy/assinaturas');

const err = (status: number, body: unknown) => new ApiError(status, 'request failed', body);

describe('resolvePlanChangeError', () => {
  it('keeps the manageUrl from a 409 NotStripeSubscription', () => {
    const out = resolvePlanChangeError(
      err(409, {
        error: 'NotStripeSubscription',
        message: 'manage your subscription in the App Store',
        manageUrl: 'https://apps.apple.com/account/subscriptions',
      }),
    );
    expect(out.reason).toBe('not_stripe');
    expect(out.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('maps a 409 InvalidStatus to invalid_status with the past-due copy', () => {
    const out = resolvePlanChangeError(
      err(409, {
        error: 'InvalidStatus',
        message: 'plan change not allowed while subscription is past_due',
        status: 'past_due',
      }),
    );
    expect(out.reason).toBe('invalid_status');
    expect(out.message).toBe(assinaturasCopy.alterar.errorPastDue);
  });

  it('maps a 409 NoChange to no_change', () => {
    const out = resolvePlanChangeError(
      err(409, { error: 'NoChange', message: 'already on this plan' }),
    );
    expect(out.reason).toBe('no_change');
    expect(out.manageUrl).toBeUndefined();
  });

  // The one the brief calls out: without this branch, a permanent combination
  // error (annual cadence + attached monthly add-ons) reads as "tente
  // novamente", which never succeeds.
  it('maps the 422 PremiumCheckoutRejected/ANNUAL_CADENCE_ADDON_UNSUPPORTED to annual_addon', () => {
    const out = resolvePlanChangeError(
      err(422, {
        error: 'PremiumCheckoutRejected',
        code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
        message: 'Modulos adicionais sao mensais e nao podem ser contratados no plano anual.',
        addonKeys: ['detailing'],
      }),
    );
    expect(out.reason).toBe('annual_addon');
  });

  it('maps a bare 422 UnprocessableEntity to generic, not annual_addon', () => {
    const out = resolvePlanChangeError(err(422, { error: 'UnprocessableEntity', issues: [] }));
    expect(out.reason).toBe('generic');
  });

  it('maps 404 PlanNotFound to plan_not_found', () => {
    expect(resolvePlanChangeError(err(404, { error: 'PlanNotFound' })).reason).toBe(
      'plan_not_found',
    );
  });

  // The two 404s are different facts: PlanNotFound means the plan is gone,
  // NotFound means the member has no live membership at all — the plan is
  // still there. Collapsing them into one reason/message tells the member
  // the wrong thing is broken and sends them retrying a different plan that
  // was never the problem.
  it('separates 404 NotFound (no live membership) from 404 PlanNotFound', () => {
    const noMembership = resolvePlanChangeError(err(404, { error: 'NotFound' }));
    const planGone = resolvePlanChangeError(err(404, { error: 'PlanNotFound' }));

    expect(noMembership.reason).toBe('no_membership');
    expect(planGone.reason).toBe('plan_not_found');
    expect(noMembership.message).not.toBe(planGone.message);
  });

  it('maps 503 to unavailable', () => {
    expect(resolvePlanChangeError(err(503, { error: 'ServiceUnavailable' })).reason).toBe(
      'unavailable',
    );
  });

  it('maps 429 to rate_limited', () => {
    expect(resolvePlanChangeError(err(429, { error: 'Error' })).reason).toBe('rate_limited');
  });

  it('maps 401 to unauthorized', () => {
    expect(resolvePlanChangeError(err(401, { error: 'Unauthorized' })).reason).toBe('unauthorized');
  });

  it('falls back to generic for a non-ApiError', () => {
    const out = resolvePlanChangeError(new Error('boom'));
    expect(out.reason).toBe('generic');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('gives every reason a non-empty message', () => {
    const cases: unknown[] = [
      err(409, { error: 'NotStripeSubscription', manageUrl: 'https://x.test' }),
      err(409, { error: 'InvalidStatus', status: 'past_due' }),
      err(409, { error: 'NoChange' }),
      err(422, { error: 'PremiumCheckoutRejected', code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED' }),
      err(404, { error: 'PlanNotFound' }),
      err(404, { error: 'NotFound' }),
      err(503, {}),
      err(429, {}),
      err(401, {}),
      new Error('boom'),
    ];
    for (const c of cases) {
      expect(resolvePlanChangeError(c).message.trim().length).toBeGreaterThan(0);
    }
  });
});
