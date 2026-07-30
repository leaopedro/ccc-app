import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openBrowserAsync = vi.fn();
const createPremiumCheckout = vi.fn();
const platform = { OS: 'android' as string };

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync }));
vi.mock('~/api/premium', () => ({ createPremiumCheckout }));

const load = async () => import('./checkout');

describe('startPremiumCheckout', () => {
  beforeEach(() => {
    vi.resetModules();
    openBrowserAsync.mockReset();
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

  // Stripe's success_url is a fixed https URL, never the app's deep link, so
  // there is no "success" signal openBrowserAsync could ever observe here.
  // Any close of the Android tab must produce 'returned' so the caller goes
  // and polls pollSubscriptionActive to learn the real outcome. This is the
  // regression test for the original bug: it fails if the Android branch
  // goes back to openAuthSessionAsync (never called here) or if it starts
  // inspecting the openBrowserAsync result instead of ignoring it.
  it('returns "returned" when the Android tab closes, regardless of how the browser result reads', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openBrowserAsync.mockResolvedValue({ type: 'cancel' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: ['detailing'] });
    expect(createPremiumCheckout).toHaveBeenCalledWith({
      planSlug: 'fundador',
      addonKeys: ['detailing'],
    });
    expect(openBrowserAsync).toHaveBeenCalledWith('https://stripe.test/s');
    expect(out).toEqual({ kind: 'returned' });
  });

  // Same tab-close event, opposite reported browser result — must still
  // produce the identical outcome. Fails if the code branches on
  // openBrowserAsync's resolved value at all (e.g. `result.type === 'success'
  // ? 'returned' : 'dismissed'`), since openBrowserAsync never reports
  // 'success' in the first place.
  it('returns "returned" even when the browser result reports "dismiss"', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openBrowserAsync.mockResolvedValue({ type: 'dismiss' });
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
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });
});
