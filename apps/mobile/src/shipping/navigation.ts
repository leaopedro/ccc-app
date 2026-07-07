import { sanitizeNext } from '../auth/redirect-intent';

export function resolveShippingReturnTo(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return sanitizeNext(value);
}

export function getShippingExitPath(returnTo: string | null): string {
  return returnTo ?? '/profile';
}

export function getShippingSavePath(addressId: string, returnTo: string | null): string {
  if (returnTo === '/cart') {
    return `/cart?shippingAddressId=${encodeURIComponent(addressId)}`;
  }
  return returnTo ?? `/profile/shipping/${addressId}`;
}

export function getShippingListPath(returnTo: string | null): string {
  return returnTo ?? '/profile/shipping';
}
