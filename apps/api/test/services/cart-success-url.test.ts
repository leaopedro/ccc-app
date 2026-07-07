import { describe, expect, it } from 'vitest';

import { withOrderIdParam } from '../../src/services/cart/success-url.js';

describe('withOrderIdParam', () => {
  it('appends orderId when no query string exists', () => {
    expect(withOrderIdParam('https://app.example.com/checkout-return', 'ord_1')).toBe(
      'https://app.example.com/checkout-return?orderId=ord_1',
    );
  });

  it('preserves existing query parameters', () => {
    expect(withOrderIdParam('https://app.example.com/checkout-return?ref=abc', 'ord_1')).toBe(
      'https://app.example.com/checkout-return?ref=abc&orderId=ord_1',
    );
  });

  it('replaces a stale orderId rather than duplicating it', () => {
    expect(withOrderIdParam('https://app.example.com/checkout-return?orderId=old', 'new')).toBe(
      'https://app.example.com/checkout-return?orderId=new',
    );
  });

  it('encodes orderId values that contain reserved characters', () => {
    expect(withOrderIdParam('https://app.example.com/checkout-return', 'a/b c')).toContain(
      'orderId=a%2Fb+c',
    );
  });

  it('falls back to string concatenation when the URL cannot be parsed', () => {
    expect(withOrderIdParam('not a url', 'ord_1')).toBe('not a url?orderId=ord_1');
  });
});
