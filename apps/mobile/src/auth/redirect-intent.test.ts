import { describe, expect, it } from 'vitest';

import {
  buildLoginHref,
  buildSignupHref,
  DEFAULT_POST_AUTH,
  isPublicPath,
  sanitizeNext,
} from './redirect-intent';

describe('isPublicPath', () => {
  it('allows root, welcome and events list', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/welcome')).toBe(true);
    expect(isPublicPath('/events')).toBe(true);
  });

  it('allows single-segment event slug', () => {
    expect(isPublicPath('/events/track-day')).toBe(true);
    expect(isPublicPath('/events/abc-123')).toBe(true);
  });

  it('allows storefront browsing routes', () => {
    expect(isPublicPath('/store')).toBe(true);
    expect(isPublicPath('/store/colecao-jdm')).toBe(true);
  });

  it('blocks event sub-routes (buy, etc.)', () => {
    expect(isPublicPath('/events/buy/track-day')).toBe(false);
    expect(isPublicPath('/events/track-day/extras')).toBe(false);
  });

  it('blocks protected paths', () => {
    expect(isPublicPath('/cart')).toBe(false);
    expect(isPublicPath('/tickets')).toBe(false);
    expect(isPublicPath('/garage')).toBe(false);
    expect(isPublicPath('/profile')).toBe(false);
  });
});

describe('sanitizeNext', () => {
  it('accepts allowlisted internal paths', () => {
    expect(sanitizeNext('/welcome')).toBe('/welcome');
    expect(sanitizeNext('/events')).toBe('/events');
    expect(sanitizeNext('/events/track-day')).toBe('/events/track-day');
    expect(sanitizeNext('/events/track-day?tierId=t1')).toBe('/events/track-day?tierId=t1');
    expect(sanitizeNext('/store')).toBe('/store');
    expect(sanitizeNext('/cart')).toBe('/cart');
    expect(sanitizeNext('/cart/car-plate')).toBe('/cart/car-plate');
    expect(sanitizeNext('/tickets')).toBe('/tickets');
    expect(sanitizeNext('/garage')).toBe('/garage');
    expect(sanitizeNext('/profile')).toBe('/profile');
    expect(sanitizeNext('/caixa/preferencias')).toBe('/caixa/preferencias');
  });

  it('rejects open-redirect attempts', () => {
    expect(sanitizeNext('//evil.com')).toBeNull();
    expect(sanitizeNext('//evil.com/path')).toBeNull();
    expect(sanitizeNext('/\\evil.com')).toBeNull();
    expect(sanitizeNext('https://evil.com')).toBeNull();
    expect(sanitizeNext('http://evil.com')).toBeNull();
    expect(sanitizeNext('javascript://evil')).toBeNull();
    expect(sanitizeNext('mailto:foo@bar.com')).toBeNull();
  });

  it('rejects non-allowlisted internal paths', () => {
    expect(sanitizeNext('/login')).toBeNull();
    expect(sanitizeNext('/signup')).toBeNull();
    expect(sanitizeNext('/admin')).toBeNull();
    expect(sanitizeNext('/debug-sentry')).toBeNull();
    expect(sanitizeNext('/')).toBeNull();
  });

  it('rejects malformed and unsafe inputs', () => {
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
    expect(sanitizeNext('')).toBeNull();
    expect(sanitizeNext(42)).toBeNull();
    expect(sanitizeNext('events')).toBeNull();
    expect(sanitizeNext('/events\nfoo')).toBeNull();
    expect(sanitizeNext('/events\r\nfoo')).toBeNull();
    expect(sanitizeNext('/' + 'a'.repeat(600))).toBeNull();
  });

  it('treats prefix match as path-segment, not substring', () => {
    expect(sanitizeNext('/eventsfake')).toBeNull();
    expect(sanitizeNext('/cartman')).toBeNull();
    expect(sanitizeNext('/profilex')).toBeNull();
  });
});

describe('buildLoginHref / buildSignupHref', () => {
  it('returns plain path when next missing or invalid', () => {
    expect(buildLoginHref(null)).toBe('/login');
    expect(buildLoginHref(undefined)).toBe('/login');
    expect(buildLoginHref('//evil.com')).toBe('/login');
    expect(buildSignupHref(null)).toBe('/signup');
    expect(buildSignupHref('https://evil.com')).toBe('/signup');
  });

  it('encodes the next query param when valid', () => {
    expect(buildLoginHref('/cart')).toBe('/login?next=%2Fcart');
    expect(buildLoginHref('/events/track-day?tierId=t1')).toBe(
      '/login?next=%2Fevents%2Ftrack-day%3FtierId%3Dt1',
    );
    expect(buildSignupHref('/events/track-day')).toBe('/signup?next=%2Fevents%2Ftrack-day');
  });
});

describe('DEFAULT_POST_AUTH', () => {
  it('lands authenticated users on /garage (per-user pivot)', () => {
    expect(DEFAULT_POST_AUTH).toBe('/garage');
  });
});
