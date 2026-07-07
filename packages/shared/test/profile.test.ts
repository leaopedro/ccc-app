import { describe, expect, it } from 'vitest';

import { publicProfileSchema, updateProfileSchema } from '../src/profile';

describe('updateProfileSchema', () => {
  it('accepts partial updates', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: 'hi' }).success).toBe(true);
  });

  it('rejects state codes longer than 2 chars', () => {
    expect(updateProfileSchema.safeParse({ stateCode: 'SPX' }).success).toBe(false);
  });

  it('rejects bio over 500 chars', () => {
    expect(updateProfileSchema.safeParse({ bio: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('publicProfileSchema', () => {
  it('requires the auth fields plus profile fields', () => {
    const ok = publicProfileSchema.safeParse({
      id: 'u1',
      email: 'a@b.co',
      name: 'n',
      role: 'user',
      emailVerifiedAt: null,
      createdAt: new Date().toISOString(),
      bio: null,
      city: null,
      stateCode: null,
      avatarUrl: null,
    });
    expect(ok.success).toBe(true);
  });
});
