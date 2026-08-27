import { buildLoginHref } from '../../auth/redirect-intent';
import type { AuthStatus } from '../events/buy-cta';

export type StoreAddCtaAction =
  | { kind: 'login'; href: string }
  | { kind: 'proceed' }
  | { kind: 'noop' };

export interface StoreAddCtaInput {
  authStatus: AuthStatus;
  productSlug: string;
  selectedVariantId: string | null;
  quantity: number;
}

/**
 * Pure resolver for the store product "Adicionar" CTA.
 *
 * Why it exists: the screen used to call `addItem` unconditionally. For an
 * anonymous visitor `authedRequest` throws `ApiError(401, 'no access token')`
 * before it even reaches the network, so the member got the generic
 * "Erro ao adicionar item ao carrinho." toast, stayed on the page, and had no
 * hint that signing in was the missing step. `/store/:slug` is deliberately a
 * public route, so browsing anonymously is correct — only the action needed a
 * door to the login screen.
 *
 * Mirrors `../events/buy-cta.ts`, which already does this for ticket tiers, and
 * keeps its convention: the round trip preserves the SELECTION, not the action.
 * The member lands back on the product with the variant and quantity restored
 * and taps "Adicionar" themselves. Nothing is bought on their behalf while they
 * were away.
 */
export const resolveStoreAddCta = ({
  authStatus,
  productSlug,
  selectedVariantId,
  quantity,
}: StoreAddCtaInput): StoreAddCtaAction => {
  // 'loading' means the token has not been read from storage yet. Redirecting
  // would bounce an already-signed-in member to the login screen.
  if (authStatus === 'loading') return { kind: 'noop' };

  if (authStatus === 'unauthenticated') {
    // Without a slug there is no product page to come back to. sanitizeNext
    // would happily accept `/store/` (it only checks the allow-list prefix), so
    // the guard has to live here or the member lands on a broken route.
    if (!productSlug) return { kind: 'login', href: buildLoginHref(null) };

    const params = new URLSearchParams();
    if (selectedVariantId) params.set('variantId', selectedVariantId);
    // Only when it differs from the screen's own default, to keep the URL short.
    if (quantity > 1) params.set('quantity', String(quantity));
    const query = params.toString();
    const next = `/store/${encodeURIComponent(productSlug)}${query ? `?${query}` : ''}`;
    return { kind: 'login', href: buildLoginHref(next) };
  }

  return { kind: 'proceed' };
};
