import { describe, expect, it } from 'vitest';

import { resolveStoreAddCta } from '../add-to-cart-cta';

describe('resolveStoreAddCta', () => {
  it('sends an anonymous visitor to login, carrying the selection in next', () => {
    // The bug this exists for: the screen called addItem directly, authedRequest
    // threw ApiError(401, 'no access token') before any fetch, and the member saw
    // "Erro ao adicionar item ao carrinho." with no way forward.
    const action = resolveStoreAddCta({
      authStatus: 'unauthenticated',
      productSlug: 'adesivo-01',
      selectedVariantId: 'var_1',
      quantity: 3,
    });

    expect(action).toEqual({
      kind: 'login',
      href: `/login?next=${encodeURIComponent('/store/adesivo-01?variantId=var_1&quantity=3')}`,
    });
  });

  it('omits the selection params when no variant is chosen yet', () => {
    const action = resolveStoreAddCta({
      authStatus: 'unauthenticated',
      productSlug: 'adesivo-01',
      selectedVariantId: null,
      quantity: 1,
    });

    expect(action).toEqual({
      kind: 'login',
      href: `/login?next=${encodeURIComponent('/store/adesivo-01')}`,
    });
  });

  it('omits quantity when it is the default of 1', () => {
    // Keeps the URL short for the common case; the screen defaults to 1 anyway.
    const action = resolveStoreAddCta({
      authStatus: 'unauthenticated',
      productSlug: 'adesivo-01',
      selectedVariantId: 'var_1',
      quantity: 1,
    });

    expect(action).toEqual({
      kind: 'login',
      href: `/login?next=${encodeURIComponent('/store/adesivo-01?variantId=var_1')}`,
    });
  });

  it('encodes a slug with characters that need escaping', () => {
    const action = resolveStoreAddCta({
      authStatus: 'unauthenticated',
      productSlug: 'camiseta & boné',
      selectedVariantId: null,
      quantity: 1,
    });

    if (action.kind !== 'login') throw new Error('esperava login');
    expect(action.href).not.toContain(' ');
    expect(action.href).not.toContain('&bon');
  });

  it('is a noop while the session is still loading', () => {
    // Redirecting here would bounce a member who IS logged in to the login
    // screen just because the token had not been read from storage yet.
    expect(
      resolveStoreAddCta({
        authStatus: 'loading',
        productSlug: 'adesivo-01',
        selectedVariantId: 'var_1',
        quantity: 1,
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('lets an authenticated member proceed', () => {
    expect(
      resolveStoreAddCta({
        authStatus: 'authenticated',
        productSlug: 'adesivo-01',
        selectedVariantId: 'var_1',
        quantity: 2,
      }),
    ).toEqual({ kind: 'proceed' });
  });

  it('falls back to a bare /login when the slug is empty', () => {
    // sanitizeNext rejects a path that is not under an allowed prefix, and
    // buildLoginHref then drops the param. Asserted so an empty slug cannot
    // produce `/login?next=/store/`.
    const action = resolveStoreAddCta({
      authStatus: 'unauthenticated',
      productSlug: '',
      selectedVariantId: null,
      quantity: 1,
    });

    expect(action).toEqual({ kind: 'login', href: '/login' });
  });
});
