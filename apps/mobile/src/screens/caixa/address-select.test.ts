import { describe, expect, it } from 'vitest';

import { canEnableAutoSend, pickInitialAddressId } from './address-select';

const addrs = [
  { id: 'a1', isDefault: false },
  { id: 'a2', isDefault: true },
];

describe('pickInitialAddressId', () => {
  it('prefers the box address when it is still in the list', () => {
    expect(pickInitialAddressId('a1', addrs)).toBe('a1');
  });

  it('falls back to the default when the box address is missing', () => {
    expect(pickInitialAddressId('gone', addrs)).toBe('a2');
    expect(pickInitialAddressId(null, addrs)).toBe('a2');
  });

  it('falls back to the first when there is no default', () => {
    expect(pickInitialAddressId(null, [{ id: 'a1', isDefault: false }])).toBe('a1');
  });

  it('returns null when there are no addresses', () => {
    expect(pickInitialAddressId('a1', [])).toBeNull();
  });
});

describe('canEnableAutoSend', () => {
  it('requires a selected address', () => {
    expect(canEnableAutoSend('a1')).toBe(true);
    expect(canEnableAutoSend(null)).toBe(false);
  });
});
