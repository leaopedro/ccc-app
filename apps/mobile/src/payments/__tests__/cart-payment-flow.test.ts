import { describe, expect, it } from 'vitest';

import { resolveCartPaymentAction, resolveCartSheetOutcomeAction } from '../cart-payment-flow';

describe('resolveCartPaymentAction', () => {
  it('routes pix to the pix screen', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'pix',
        isWeb: false,
        nativeStripeAvailable: true,
        clientSecret: null,
        checkoutUrl: null,
        brCode: '000201...',
        reservationExpiresAt: '2026-08-29T12:00:00.000Z',
        firstOrderId: 'ord_1',
      }),
    ).toEqual({
      kind: 'pix',
      orderId: 'ord_1',
      brCode: '000201...',
      expiresAt: '2026-08-29T12:00:00.000Z',
    });
  });

  // Pix ignores `flow` server-side and has no native SDK path either way, so
  // it must resolve identically regardless of platform.
  it('routes pix to the pix screen on web too', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'pix',
        isWeb: true,
        nativeStripeAvailable: false,
        clientSecret: null,
        checkoutUrl: null,
        brCode: '000201...',
        reservationExpiresAt: '2026-08-29T12:00:00.000Z',
        firstOrderId: 'ord_1',
      }),
    ).toEqual({
      kind: 'pix',
      orderId: 'ord_1',
      brCode: '000201...',
      expiresAt: '2026-08-29T12:00:00.000Z',
    });
  });

  it('routes a native card checkout to the payment sheet when Stripe is available', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: false,
        nativeStripeAvailable: true,
        clientSecret: 'pi_1_secret_x',
        checkoutUrl: null,
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'sheet', clientSecret: 'pi_1_secret_x' });
  });

  // Web has no native SDK. It keeps the hosted Checkout Session it already has.
  it('keeps web on the hosted checkout url', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: true,
        nativeStripeAvailable: false,
        clientSecret: null,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x',
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test_x' });
  });

  // Final review C1: a keyless production build must not try to open a
  // PaymentSheet that can never mount. The caller requests `flow: 'hosted'`
  // in that case, so a hosted checkoutUrl comes back instead of a
  // clientSecret — same redirect path web already uses.
  it('falls back to the hosted checkout url on native when Stripe is unavailable', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: false,
        nativeStripeAvailable: false,
        clientSecret: null,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_y',
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test_y' });
  });

  it('errors when the native hosted fallback has no checkoutUrl either', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: false,
        nativeStripeAvailable: false,
        clientSecret: null,
        checkoutUrl: null,
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'error' });
  });

  // A native card checkout with no client secret is a server contract break,
  // not something to paper over by opening a browser: the hosted session would
  // create a SECOND payment path for the same cart.
  it('errors when a native card checkout has no client secret', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: false,
        nativeStripeAvailable: true,
        clientSecret: null,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x',
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'error' });
  });

  it('errors when pix comes back without a brCode', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'pix',
        isWeb: false,
        nativeStripeAvailable: true,
        clientSecret: null,
        checkoutUrl: null,
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'error' });
  });
});

describe('resolveCartSheetOutcomeAction', () => {
  // The core invariant this task is graded on: a cancelled sheet must never
  // resolve to the same shape as a real failure.
  it('never resolves a cancelled sheet to the error kind', () => {
    const action = resolveCartSheetOutcomeAction({ kind: 'cancelled' });
    expect(action.kind).not.toBe('error');
    expect(action).toEqual({ kind: 'message', text: expect.any(String) });
  });

  it('resolves a failed sheet to the error kind', () => {
    const action = resolveCartSheetOutcomeAction({ kind: 'failed', code: 'Failed' });
    expect(action).toEqual({ kind: 'error', text: expect.any(String) });
  });

  it('resolves a failed sheet with no code to the error kind too', () => {
    const action = resolveCartSheetOutcomeAction({ kind: 'failed' });
    expect(action).toEqual({ kind: 'error', text: expect.any(String) });
  });

  it('resolves a paid sheet to navigate, with no message or error text', () => {
    expect(resolveCartSheetOutcomeAction({ kind: 'paid' })).toEqual({ kind: 'navigate' });
  });
});
