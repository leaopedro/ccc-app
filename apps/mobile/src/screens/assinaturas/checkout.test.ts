import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAuthSessionAsync = vi.fn();
const createPremiumCheckout = vi.fn();
const platform = { OS: 'android' as string };

vi.mock('react-native', () => ({ Platform: platform }));
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

  it('returns "returned" when the Android browser closes with success', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openAuthSessionAsync.mockResolvedValue({ type: 'success' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: ['detailing'] });
    expect(createPremiumCheckout).toHaveBeenCalledWith({
      planSlug: 'fundador',
      addonKeys: ['detailing'],
    });
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      'https://stripe.test/s',
      'ccc://premium/return',
    );
    expect(out).toEqual({ kind: 'returned' });
  });

  it('returns "dismissed" when the user closes the browser', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out).toEqual({ kind: 'dismissed' });
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
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
