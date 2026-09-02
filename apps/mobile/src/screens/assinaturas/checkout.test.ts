import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPremiumCheckout = vi.fn();
const createPremiumSubscriptionNative = vi.fn();
const openAuthSessionAsync = vi.fn();
const platform = { OS: 'android' as string };

vi.mock('react-native', () => ({ Platform: platform }));
// checkout.ts imports ./checkout-error, which reaches ~/api/client and
// therefore expo-constants. Stub it so this stays a plain node run.
//
// `extra` is mutable so a test can add/remove the publishable key without
// re-mocking the module — checkout.ts reads it at call time (final review C1).
const expoExtra = vi.hoisted(() => ({ value: {} as { stripePublishableKey?: string } }));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: expoExtra.value };
    },
  },
}));
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (url: string) => openAuthSessionAsync(url),
}));
vi.mock('~/api/premium', () => ({ createPremiumCheckout, createPremiumSubscriptionNative }));

const load = async () => import('./checkout');

describe('startPremiumCheckout', () => {
  beforeEach(() => {
    vi.resetModules();
    createPremiumCheckout.mockReset();
    createPremiumSubscriptionNative.mockReset();
    openAuthSessionAsync.mockReset();
    platform.OS = 'android';
    // Default: a build that HAS a key, so the iOS cases below exercise the
    // native seam. The keyless cases set this to `{}` explicitly.
    expoExtra.value = { stripePublishableKey: 'pk_test_checkout' };
  });

  afterEach(() => {
    // Only the web test defines this; unconditional delete keeps other tests
    // (which run in a plain node environment with no `window`) unaffected.
    Reflect.deleteProperty(globalThis, 'window');
  });

  // Task 6: iOS now subscribes natively through the same PaymentSheet as
  // every other native platform. The old `ios_unsupported` outcome (in-app
  // steering to an external purchase method, forbidden by the 3.1.3
  // chapeau) is gone.
  it('returns a sheet outcome on iOS instead of the old ios_unsupported', async () => {
    platform.OS = 'ios';
    createPremiumSubscriptionNative.mockResolvedValue({ clientSecret: 'pi_sub_secret_x' });
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out).toEqual({ kind: 'sheet', clientSecret: 'pi_sub_secret_x' });
    expect(createPremiumCheckout).not.toHaveBeenCalled();
  });

  // Final review C1 — the App Store build regression. eas.json `production`
  // sets EXPO_PUBLIC_PREMIUM_BILLING_ENABLED but no
  // EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY, so `shouldMountStripeProvider` is
  // false and no PaymentSheet can ever be presented. Taking the native branch
  // there created a real Stripe subscription plus a `pending` attempt row and
  // THEN dead-ended, leaving the member with a generic error and an attempt
  // lock that blocks switching plans.
  //
  // The decision must happen before the server call, so a keyless build never
  // creates that state at all. These three assertions are the whole fix:
  // no checkout-native call, a hosted URL opened, a `returned` outcome the
  // screen knows how to poll on.
  it('falls back to the hosted subscription checkout on iOS when the build has no publishable key', async () => {
    platform.OS = 'ios';
    expoExtra.value = {};
    createPremiumCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/cs_ios_keyless',
    });
    openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(createPremiumSubscriptionNative).not.toHaveBeenCalled();
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_ios_keyless',
    );
    expect(out).toEqual({ kind: 'returned' });
  });

  // The empty-string case is the one the real config produces:
  // app.config.ts writes `process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''`
  // into extra, so an unset env var arrives as '' rather than undefined. A
  // truthiness check that only handled `undefined` would still dead-end.
  it('treats an empty publishable key as absent on iOS', async () => {
    platform.OS = 'ios';
    expoExtra.value = { stripePublishableKey: '' };
    createPremiumCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/cs_ios_empty_key',
    });
    openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(createPremiumSubscriptionNative).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: 'returned' });
  });

  // Final review I1: Android stays on the hosted browser flow, matching
  // PremiumScreen.tsx's onSubscribeAndroid and the pre-branch behaviour.
  // Whether Android migrates to the sheet is a product decision parked on a
  // human, not something the iOS PaymentSheet seam should decide as a
  // side effect.
  it('still opens the hosted checkout on Android, not the sheet', async () => {
    platform.OS = 'android';
    createPremiumCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/cs_android',
    });
    openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out).toEqual({ kind: 'returned' });
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_android',
    );
    expect(createPremiumSubscriptionNative).not.toHaveBeenCalled();
  });

  // Web has no native SDK; it keeps the hosted Checkout Session. A suite that
  // only proved the native path would pass against an implementation that
  // broke web subscribing, so this direction is pinned too.
  it('still redirects on web', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_x' });
    const win = { location: { href: '' } };
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
    const { startPremiumCheckout } = await load();
    platform.OS = 'web';

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out).toEqual({ kind: 'redirected' });
    expect(win.location.href).toBe('https://checkout.stripe.com/c/pay/cs_x');
    expect(createPremiumSubscriptionNative).not.toHaveBeenCalled();
  });

  it('maps a native checkout-native failure to an error outcome', async () => {
    platform.OS = 'ios';
    createPremiumSubscriptionNative.mockRejectedValue(new Error('boom'));
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out.kind).toBe('error');
  });

  // The seam used to keep only `err.message`, which is the literal string
  // 'request failed' for every non-2xx, so the screen could not tell 409 from
  // 503. checkout-native shares resolveSubscriptionPackage with the hosted
  // checkoutHandler on the API side, so it returns the identical error
  // shapes — the same mapper (resolveCheckoutError) handles both.
  it('keeps the status so an AlreadySubscribed 409 from checkout-native stays distinguishable', async () => {
    platform.OS = 'ios';
    const { ApiError } = await import('~/api/client');
    createPremiumSubscriptionNative.mockRejectedValue(
      new ApiError(409, 'request failed', {
        error: 'AlreadySubscribed',
        manageUrl: 'https://billing.stripe.com/session/abc',
      }),
    );
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    if (out.kind !== 'error') throw new Error('expected an error outcome');
    expect(out.error.reason).toBe('already_subscribed');
    expect(out.error.manageUrl).toBe('https://billing.stripe.com/session/abc');
  });

  // The endpoint can also answer 409 SubscriptionAttemptInFlight (a pending
  // native attempt or an open hosted Checkout Session for the same garage).
  // That is a conflicting-attempt fact, not "you already have a
  // subscription" — resolveCheckoutError gives it its own reason so the
  // member is told to wait/retry instead of being pointed at a `manageUrl`
  // for a subscription that does not exist.
  it('maps a SubscriptionAttemptInFlight 409 from checkout-native to its own reason, not already_subscribed', async () => {
    platform.OS = 'ios';
    const { ApiError } = await import('~/api/client');
    createPremiumSubscriptionNative.mockRejectedValue(
      new ApiError(409, 'request failed', {
        error: 'SubscriptionAttemptInFlight',
        message: 'ja existe uma tentativa de assinatura em andamento',
      }),
    );
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    if (out.kind !== 'error') throw new Error('expected an error outcome');
    expect(out.error.reason).toBe('attempt_in_flight');
    expect(out.error.manageUrl).toBeUndefined();
  });

  // 422: annual cadence + add-ons is a combination error, not an
  // availability error — checkAnnualCadenceAddonRejection on the API side.
  it('maps a 422 annual+add-on rejection from checkout-native to an error outcome', async () => {
    platform.OS = 'ios';
    const { ApiError } = await import('~/api/client');
    createPremiumSubscriptionNative.mockRejectedValue(
      new ApiError(422, 'request failed', {
        error: 'PremiumCheckoutRejected',
        code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
        message: 'Modulos adicionais sao mensais e nao podem ser contratados no plano anual.',
        addonKeys: ['detailing'],
      }),
    );
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({
      planSlug: 'fundador',
      addonKeys: ['detailing'],
    });

    expect(out.kind).toBe('error');
  });

  // 403: requireSubscriptionsEnabled closes the platform gate.
  it('maps a 403 platform-gate-off response from checkout-native to an error outcome', async () => {
    platform.OS = 'ios';
    const { ApiError } = await import('~/api/client');
    createPremiumSubscriptionNative.mockRejectedValue(
      new ApiError(403, 'request failed', { error: 'SubscriptionsDisabled' }),
    );
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out.kind).toBe('error');
  });
});
