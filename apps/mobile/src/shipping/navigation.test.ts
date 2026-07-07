import { describe, expect, it } from 'vitest';

import {
  getShippingExitPath,
  getShippingListPath,
  getShippingSavePath,
  resolveShippingReturnTo,
} from './navigation';

describe('shipping navigation helpers', () => {
  it('sanitizes supported return targets', () => {
    expect(resolveShippingReturnTo('/cart')).toBe('/cart');
    expect(resolveShippingReturnTo('/profile')).toBe('/profile');
    expect(resolveShippingReturnTo('/profile/shipping')).toBe('/profile/shipping');
    expect(resolveShippingReturnTo(['/cart'])).toBe('/cart');
  });

  it('rejects unsupported return targets', () => {
    expect(resolveShippingReturnTo('/login')).toBeNull();
    expect(resolveShippingReturnTo('//evil.com')).toBeNull();
    expect(resolveShippingReturnTo(undefined)).toBeNull();
  });

  it('computes exit and save destinations', () => {
    expect(getShippingExitPath('/cart')).toBe('/cart');
    expect(getShippingExitPath(null)).toBe('/profile');
    expect(getShippingListPath('/cart')).toBe('/cart');
    expect(getShippingListPath(null)).toBe('/profile/shipping');
    expect(getShippingSavePath('addr_1', '/cart')).toBe('/cart?shippingAddressId=addr_1');
    expect(getShippingSavePath('addr_1', null)).toBe('/profile/shipping/addr_1');
  });
});
