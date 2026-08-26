import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAuthSessionAsync = vi.fn();
const createPremiumCheckout = vi.fn();
const platform = { OS: 'android' as string };

vi.mock('react-native', () => ({ Platform: platform }));
// checkout.ts now imports ./checkout-error, which reaches ~/api/client and
// therefore expo-constants. Stub it so this stays a plain node run.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync }));
vi.mock('~/api/premium', () => ({ createPremiumCheckout }));

const load = async () => import('./checkout');

describe('startPremiumCheckout', () => {
  beforeEach(() => {
    vi.resetModules();
    openAuthSessionAsync.mockReset();
    createPremiumCheckout.mockReset();
    platform.OS = 'android';
  });

  afterEach(() => {
    // Only the web test defines this; unconditional delete keeps other tests
    // (which run in a plain node environment with no `window`) unaffected.
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('never touches the API on iOS', async () => {
    platform.OS = 'ios';
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out).toEqual({ kind: 'ios_unsupported' });
    expect(createPremiumCheckout).not.toHaveBeenCalled();
  });

  // Regression test for the original bug. Stripe's success_url is a fixed
  // https URL, never a deep link, so on real Android devices
  // openAuthSessionAsync's `result.type` is never actually 'success',
  // nothing ever produces it. This test deliberately mocks 'success' anyway
  // and asserts the outcome is 'returned' regardless: it goes RED if the
  // implementation is changed back to `result.type === 'success' ?
  // 'returned' : 'dismissed'`, which is the exact original bug (a check
  // that can pass in a test double but is dead on every real device).
  it('returns "returned" once openAuthSessionAsync resolves, even with type "success"', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openAuthSessionAsync.mockResolvedValue({ type: 'success' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: ['detailing'] });
    expect(createPremiumCheckout).toHaveBeenCalledWith({
      planSlug: 'fundador',
      addonKeys: ['detailing'],
    });
    expect(openAuthSessionAsync).toHaveBeenCalledWith('https://stripe.test/s');
    expect(out).toEqual({ kind: 'returned' });
  });

  // Same call, the result.type Android's AppState polyfill actually produces
  // once the tab is closed without a matching redirect ('dismiss'), must
  // still map to the identical outcome. Fails if the code branches on
  // `result.type` at all, in either direction.
  it('returns "returned" regardless of which result.type openAuthSessionAsync resolves with', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out).toEqual({ kind: 'returned' });
  });

  it('maps an API failure to an error outcome', async () => {
    createPremiumCheckout.mockRejectedValue(new Error('boom'));
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out.kind).toBe('error');
  });

  // The seam used to keep only `err.message`, which is the literal string
  // 'request failed' for every non-2xx, so the screen could not tell 409 from
  // 503. Goes RED if the status is discarded again.
  it('keeps the status so an AlreadySubscribed 409 stays distinguishable', async () => {
    const { ApiError } = await import('~/api/client');
    createPremiumCheckout.mockRejectedValue(
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

  it('returns "redirected" and navigates when Platform.OS is web, checked at call time', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    // A false negative here would also pass a module-scope `const OS = Platform.OS`
    // read: import happens while OS is still 'android' (the beforeEach default),
    // then the flip to 'web' below happens strictly after import. Only a read
    // done inside the function body, at call time, observes 'web'.
    const win = { location: { href: '' } };
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
    const { startPremiumCheckout } = await load();
    platform.OS = 'web';

    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

    expect(out).toEqual({ kind: 'redirected' });
    expect(win.location.href).toBe('https://stripe.test/s');
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
