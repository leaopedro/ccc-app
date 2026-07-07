import { describe, expect, it } from 'vitest';

import {
  clearPendingCheckoutUrl,
  getPendingCheckoutUrl,
  setPendingCheckoutUrl,
} from './web-pending-checkout';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('pending checkout url storage', () => {
  it('persists and reads a url per order id', () => {
    const storage = fakeStorage();
    setPendingCheckoutUrl('order-1', 'https://checkout.stripe.test/sess_1', { storage });
    setPendingCheckoutUrl('order-2', 'https://checkout.stripe.test/sess_2', { storage });

    expect(getPendingCheckoutUrl('order-1', { storage })).toBe(
      'https://checkout.stripe.test/sess_1',
    );
    expect(getPendingCheckoutUrl('order-2', { storage })).toBe(
      'https://checkout.stripe.test/sess_2',
    );
  });

  it('returns null when no url stored for that order', () => {
    const storage = fakeStorage();
    expect(getPendingCheckoutUrl('order-missing', { storage })).toBeNull();
  });

  it('clear removes only the targeted order', () => {
    const storage = fakeStorage();
    setPendingCheckoutUrl('order-a', 'https://a.test', { storage });
    setPendingCheckoutUrl('order-b', 'https://b.test', { storage });

    clearPendingCheckoutUrl('order-a', { storage });

    expect(getPendingCheckoutUrl('order-a', { storage })).toBeNull();
    expect(getPendingCheckoutUrl('order-b', { storage })).toBe('https://b.test');
  });

  it('no-ops when storage is unavailable (null)', () => {
    expect(() => setPendingCheckoutUrl('x', 'https://x.test', { storage: null })).not.toThrow();
    expect(getPendingCheckoutUrl('x', { storage: null })).toBeNull();
    expect(() => clearPendingCheckoutUrl('x', { storage: null })).not.toThrow();
  });

  it('no-ops on empty orderId or url', () => {
    const storage = fakeStorage();
    setPendingCheckoutUrl('', 'https://x.test', { storage });
    setPendingCheckoutUrl('order-1', '', { storage });
    expect(storage.length).toBe(0);
  });
});
