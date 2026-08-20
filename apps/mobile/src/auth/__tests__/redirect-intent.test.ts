import { describe, expect, it } from 'vitest';

import { buildLoginHref, isPublicPath, sanitizeNext } from '~/auth/redirect-intent';

describe('sanitizeNext — jornada de assinatura', () => {
  it('accepts /assinaturas so the subscribe CTA survives the login round trip', () => {
    expect(sanitizeNext('/assinaturas')).toBe('/assinaturas');
  });

  it('accepts a plan detail path under /assinaturas', () => {
    expect(sanitizeNext('/assinaturas/ouro')).toBe('/assinaturas/ouro');
  });

  it('rejects a path that shares the /assinaturas prefix but not a segment boundary', () => {
    // Catches: relaxing the segment-boundary check in sanitizeNext (e.g.
    // `path.startsWith(prefix)` instead of `path === prefix ||
    // path.startsWith(`${prefix}/`)`), which would let an attacker-controlled
    // path like /assinaturasEVIL ride the /assinaturas allowlist entry.
    expect(sanitizeNext('/assinaturasEVIL')).toBeNull();
  });

  it('rejects a path that shares an existing prefix but not a segment boundary', () => {
    // Same property, pinned against a pre-existing prefix so it is not
    // scoped only to the /assinaturas entry this task added.
    expect(sanitizeNext('/garageXYZ')).toBeNull();
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

describe('Task 14 — /inicio tab route', () => {
  it('treats /inicio as public so the anonymous tab tap never bounces to login', () => {
    // Catches: forgetting to add '/inicio' to PUBLIC_EXACT. Without it, an
    // anonymous visitor tapping the new Início tab would be redirected to
    // /login, the exact opposite of what the tab is for.
    expect(isPublicPath('/inicio')).toBe(true);
  });

  it('allows /inicio through sanitizeNext so login can send the user back to it', () => {
    expect(sanitizeNext('/inicio')).toBe('/inicio');
  });

  it('rejects a path that shares the /inicio prefix but not a segment boundary', () => {
    // Catches: matching '/inicio' as a raw string prefix (path.startsWith
    // ('/inicio')) instead of the segment-boundary check (path === prefix ||
    // path.startsWith(`${prefix}/`)). A raw-prefix match would let
    // /inicioEVIL ride the /inicio allowlist entry.
    expect(sanitizeNext('/inicioEVIL')).toBeNull();
  });

  it('keeps /welcome public and passing sanitizeNext, as the historic alias', () => {
    // Catches: removing '/welcome' from PUBLIC_EXACT or NEXT_ALLOWED_PREFIXES
    // while adding '/inicio', which would break old deep links and any
    // already-persisted next=/welcome.
    expect(isPublicPath('/welcome')).toBe(true);
    expect(sanitizeNext('/welcome')).toBe('/welcome');
  });
});
