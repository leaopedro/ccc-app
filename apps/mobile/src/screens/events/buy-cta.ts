import { buildLoginHref } from '../../auth/redirect-intent';

export type AuthStatus = 'authenticated' | 'unauthenticated' | 'loading';

export type BuyCtaAction = { kind: 'login'; href: string } | { kind: 'cart' } | { kind: 'noop' };

export interface BuyCtaInput {
  authStatus: AuthStatus;
  eventSlug: string;
  selectedTierId: string | null;
}

// Pure resolver for the event-detail purchase CTA.
// Anonymous → route through /login back to the event detail, preserving the
// selected tier in the query string when present. Authenticated users continue
// in the cart flow. Loading or authenticated-without-selection is a no-op.
export const resolveBuyCta = ({
  authStatus,
  eventSlug,
  selectedTierId,
}: BuyCtaInput): BuyCtaAction => {
  if (authStatus === 'unauthenticated') {
    const next = selectedTierId
      ? `/events/${eventSlug}?tierId=${selectedTierId}`
      : `/events/${eventSlug}`;
    return { kind: 'login', href: buildLoginHref(next) };
  }
  if (authStatus === 'authenticated' && selectedTierId) {
    return { kind: 'cart' };
  }
  return { kind: 'noop' };
};

export const isBuyCtaDisabled = (input: BuyCtaInput): boolean =>
  input.authStatus === 'authenticated' && !input.selectedTierId;
