import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createPremiumCheckout = vi.fn();
const createPremiumSubscriptionNative = vi.fn();
const platform = { OS: 'android' as string };

vi.mock('react-native', () => ({ Platform: platform }));
// checkout.ts imports ./checkout-error, which reaches ~/api/client and
// therefore expo-constants. Stub it so this stays a plain node run.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('~/api/premium', () => ({ createPremiumCheckout, createPremiumSubscriptionNative }));

const load = async () => import('./checkout');

describe('startPremiumCheckout', () => {
  beforeEach(() => {
    vi.resetModules();
    createPremiumCheckout.mockReset();
    createPremiumSubscriptionNative.mockReset();
    platform.OS = 'android';
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

  // Android also moves off the hosted-browser flow onto the sheet — the
  // point of Task 4/5's single PaymentSheet seam is that every native
  // platform goes through it, not just iOS.
  it('returns a sheet outcome on Android too', async () => {
    platform.OS = 'android';
    createPremiumSubscriptionNative.mockResolvedValue({ clientSecret: 'pi_sub_secret_y' });
    const { startPremiumCheckout } = await load();

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out).toEqual({ kind: 'sheet', clientSecret: 'pi_sub_secret_y' });
    expect(createPremiumSubscriptionNative).toHaveBeenCalledWith({
      planSlug: 'fundador',
      addonKeys: [],
    });
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
