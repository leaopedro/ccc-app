import { describe, expect, it } from 'vitest';

import {
  resolveClientPlatform,
  subscriptionsEnabledFor,
} from '../../src/services/platform-gate/resolve.js';

const ALL_ON = { ios: true, android: true, web: true };

describe('resolveClientPlatform', () => {
  it('trusts an explicit, known header', () => {
    expect(resolveClientPlatform({ platform: 'ios' })).toBe('ios');
    expect(resolveClientPlatform({ platform: 'android' })).toBe('android');
    expect(resolveClientPlatform({ platform: 'web' })).toBe('web');
  });

  it('is case-insensitive and trims', () => {
    expect(resolveClientPlatform({ platform: '  IOS ' })).toBe('ios');
  });

  it('falls back to web for a declared browser user-agent', () => {
    expect(
      resolveClientPlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      }),
    ).toBe('web');
  });

  // Fail-closed: the whole point of the gate is that a missing header on a
  // native client must NOT be served the permissive answer.
  it('falls back to ios when the user-agent looks native and no header is present', () => {
    expect(
      resolveClientPlatform({ userAgent: 'CasaCarClub/1.4.0 CFNetwork/1494 Darwin/23.4.0' }),
    ).toBe('ios');
    expect(resolveClientPlatform({ userAgent: 'okhttp/4.12.0' })).toBe('android');
  });

  it('treats a Mozilla-prefixed Android UA as web, because that is our web app on Android', () => {
    expect(
      resolveClientPlatform({
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
      }),
    ).toBe('web');
  });

  it('treats a Mozilla-prefixed iPhone Safari UA as web, for the same reason', () => {
    expect(
      resolveClientPlatform({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      }),
    ).toBe('web');
  });

  it('classifies a native iOS UA before the browser check can see it', () => {
    expect(
      resolveClientPlatform({ userAgent: 'CasaCarClub/1.4.0 CFNetwork/1494 Darwin/23.4.0' }),
    ).toBe('ios');
  });

  it('still lets an explicit header override any user-agent', () => {
    expect(
      resolveClientPlatform({
        platform: 'ios',
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/126',
      }),
    ).toBe('ios');
  });

  it('falls back to ios when nothing at all is known', () => {
    expect(resolveClientPlatform({})).toBe('ios');
  });

  it('ignores an unknown header value and falls back', () => {
    expect(resolveClientPlatform({ platform: 'windows-phone' })).toBe('ios');
  });
});

describe('subscriptionsEnabledFor', () => {
  it('is enabled when every platform var is on', () => {
    expect(subscriptionsEnabledFor('ios', ALL_ON)).toBe(true);
  });

  it('disables only the named platform', () => {
    const env = { ios: false, android: true, web: true };
    expect(subscriptionsEnabledFor('ios', env)).toBe(false);
    expect(subscriptionsEnabledFor('android', env)).toBe(true);
    expect(subscriptionsEnabledFor('web', env)).toBe(true);
  });
});
