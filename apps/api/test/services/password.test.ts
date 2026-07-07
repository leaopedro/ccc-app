import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/services/auth/password.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('aaaaaaaaaa');
    expect(await verifyPassword('bbbbbbbbbb', hash)).toBe(false);
  });
});
