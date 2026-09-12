import { describe, expect, it, vi } from 'vitest';

// `~/api/client` imports react-native directly (for the x-ccc-platform
// header) and reads expo-constants at module load, which also pulls
// react-native into a plain node run. Same stub plan-change-error.test.ts
// uses.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { ApiError } = await import('~/api/client');
const { resolveAddonError } = await import('./addon-error');
const { assinaturasCopy } = await import('~/copy/assinaturas');

const err = (status: number, body: unknown) => new ApiError(status, 'request failed', body);

describe('resolveAddonError', () => {
  it('keeps the manageUrl from a 409 NotStripeSubscription on attach', () => {
    const out = resolveAddonError(
      err(409, {
        error: 'NotStripeSubscription',
        message: 'manage your subscription in the App Store',
        manageUrl: 'https://apps.apple.com/account/subscriptions',
      }),
      'attach',
    );
    expect(out.reason).toBe('not_stripe');
    expect(out.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('keeps the manageUrl from a 409 NotStripeSubscription on detach', () => {
    const out = resolveAddonError(
      err(409, {
        error: 'NotStripeSubscription',
        manageUrl: 'https://apps.apple.com/account/subscriptions',
      }),
      'detach',
    );
    expect(out.reason).toBe('not_stripe');
    expect(out.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  // Final review (Conserto 1): the 409 InvalidStatus for attach used to
  // reuse `alterar.errorPastDue`, which asserts a pending charge — true for
  // past_due, false for paused (the server 409s InvalidStatus for BOTH,
  // me-premium-addons.ts:223). This is the module surface's own copy, which
  // must not assert a cause the paused case falsifies.
  it('maps a 409 InvalidStatus on attach to the modules-specific copy, not the plan-change copy', () => {
    const out = resolveAddonError(
      err(409, {
        error: 'InvalidStatus',
        message: 'add-on attach not allowed while subscription is past_due',
        status: 'past_due',
      }),
      'attach',
    );
    expect(out.reason).toBe('invalid_status');
    expect(out.message).toBe(assinaturasCopy.minhaAssinatura.modulos.errorInvalidStatus);
    expect(out.message).not.toBe(assinaturasCopy.alterar.errorPastDue);
  });

  it('maps a 409 InvalidStatus on attach the same way for a paused subscription', () => {
    const out = resolveAddonError(
      err(409, {
        error: 'InvalidStatus',
        message: 'add-on attach not allowed while subscription is paused',
        status: 'paused',
      }),
      'attach',
    );
    expect(out.reason).toBe('invalid_status');
    expect(out.message).toBe(assinaturasCopy.minhaAssinatura.modulos.errorInvalidStatus);
    // The old (reused) copy claims a pending charge, which is false for a
    // paused subscription — must not leak in here.
    expect(out.message).not.toContain('cobrança');
  });

  it('maps a 409 AlreadyExists on attach to already_attached', () => {
    const out = resolveAddonError(
      err(409, { error: 'AlreadyExists', message: 'add-on already attached' }),
      'attach',
    );
    expect(out.reason).toBe('already_attached');
  });

  it('maps an unrecognized 409 body to generic', () => {
    const out = resolveAddonError(err(409, { error: 'SomethingElse' }), 'attach');
    expect(out.reason).toBe('generic');
  });

  // 404 means a different fact on each verb: on attach the module is
  // missing from the catalog, on detach the add-on simply isn't attached.
  it('maps a 404 on attach to module_not_found', () => {
    const out = resolveAddonError(err(404, { error: 'NotFound' }), 'attach');
    expect(out.reason).toBe('module_not_found');
  });

  it('maps a 404 on detach to not_attached', () => {
    const out = resolveAddonError(err(404, { error: 'NotFound' }), 'detach');
    expect(out.reason).toBe('not_attached');
    expect(resolveAddonError(err(404, { error: 'NotFound' }), 'attach').message).not.toBe(
      resolveAddonError(err(404, { error: 'NotFound' }), 'detach').message,
    );
  });

  it('maps 503 to unavailable', () => {
    expect(resolveAddonError(err(503, { error: 'ServiceUnavailable' }), 'attach').reason).toBe(
      'unavailable',
    );
  });

  it('maps 429 to rate_limited', () => {
    expect(resolveAddonError(err(429, { error: 'Error' }), 'attach').reason).toBe('rate_limited');
  });

  it('maps 401 to unauthorized', () => {
    expect(resolveAddonError(err(401, { error: 'Unauthorized' }), 'attach').reason).toBe(
      'unauthorized',
    );
  });

  it('falls back to generic for a non-ApiError', () => {
    const out = resolveAddonError(new Error('boom'), 'attach');
    expect(out.reason).toBe('generic');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('gives every reason a non-empty message, for both actions', () => {
    const cases: { error: unknown; action: 'attach' | 'detach' }[] = [
      {
        error: err(409, { error: 'NotStripeSubscription', manageUrl: 'https://x.test' }),
        action: 'attach',
      },
      { error: err(409, { error: 'InvalidStatus', status: 'past_due' }), action: 'attach' },
      { error: err(409, { error: 'InvalidStatus', status: 'paused' }), action: 'attach' },
      { error: err(409, { error: 'AlreadyExists' }), action: 'attach' },
      { error: err(404, { error: 'NotFound' }), action: 'attach' },
      { error: err(404, { error: 'NotFound' }), action: 'detach' },
      { error: err(503, {}), action: 'attach' },
      { error: err(429, {}), action: 'attach' },
      { error: err(401, {}), action: 'attach' },
      { error: new Error('boom'), action: 'attach' },
    ];
    for (const { error, action } of cases) {
      expect(resolveAddonError(error, action).message.trim().length).toBeGreaterThan(0);
    }
  });
});
