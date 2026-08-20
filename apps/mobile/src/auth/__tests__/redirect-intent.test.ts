import { describe, expect, it } from 'vitest';

import { buildLoginHref, isPublicPath, sanitizeNext } from '~/auth/redirect-intent';

describe('sanitizeNext — jornada de assinatura', () => {
  it('accepts /assinaturas so the subscribe CTA survives the login round trip', () => {
    expect(sanitizeNext('/assinaturas')).toBe('/assinaturas');
  });

  it('accepts a plan detail path under /assinaturas', () => {
    expect(sanitizeNext('/assinaturas/ouro')).toBe('/assinaturas/ouro');
  });

  it('still rejects absolute and protocol-relative urls', () => {
    expect(sanitizeNext('https://evil.example.com/assinaturas')).toBeNull();
    expect(sanitizeNext('//evil.example.com')).toBeNull();
  });
});

describe('buildLoginHref', () => {
  it('carries /assinaturas as the next param', () => {
    expect(buildLoginHref('/assinaturas')).toContain('assinaturas');
  });
});

describe('isPublicPath — /assinaturas continues to require login', () => {
  it('does not treat /assinaturas as a public path', () => {
    // The story says an unauthenticated user follows the login/signup flow
    // to subscribe, not a public page. If a future change moves
    // '/assinaturas' into PUBLIC_EXACT, this must fail.
    expect(isPublicPath('/assinaturas')).toBe(false);
  });
});
