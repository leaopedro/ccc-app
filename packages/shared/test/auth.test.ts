import { describe, expect, it } from 'vitest';

import {
  appleSignInSchema,
  authResponseSchema,
  forgotPasswordSchema,
  googleSignInSchema,
  loginSchema,
  publicUserSchema,
  refreshSchema,
  resendVerifySchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from '../src/auth';

describe('auth schemas', () => {
  it('accepts a valid signup', () => {
    expect(() =>
      signupSchema.parse({
        email: 'alice@jdm.app',
        password: 'correct-horse-battery-staple',
        name: 'Alice',
      }),
    ).not.toThrow();
  });

  it('rejects short passwords', () => {
    expect(() => signupSchema.parse({ email: 'a@b.co', password: 'short', name: 'A' })).toThrow();
  });

  it('normalizes email to lower-case', () => {
    const parsed = signupSchema.parse({
      email: 'Alice@JDM.APP',
      password: 'correct-horse-battery-staple',
      name: 'Alice',
    });
    expect(parsed.email).toBe('alice@jdm.app');
  });

  it('accepts login + refresh + logout shapes', () => {
    expect(() => loginSchema.parse({ email: 'a@b.co', password: 'x'.repeat(10) })).not.toThrow();
    expect(() => refreshSchema.parse({ refreshToken: 't'.repeat(10) })).not.toThrow();
  });

  it('accepts verify + resend + forgot + reset shapes', () => {
    expect(() => verifyEmailSchema.parse({ token: 't'.repeat(10) })).not.toThrow();
    expect(() => resendVerifySchema.parse({ email: 'a@b.co' })).not.toThrow();
    expect(() => forgotPasswordSchema.parse({ email: 'a@b.co' })).not.toThrow();
    expect(() =>
      resetPasswordSchema.parse({ token: 't'.repeat(10), password: 'x'.repeat(10) }),
    ).not.toThrow();
  });

  it('accepts social sign-in shapes', () => {
    expect(() => googleSignInSchema.parse({ idToken: 'jwt-from-google' })).not.toThrow();
    expect(() => appleSignInSchema.parse({ idToken: 'jwt-from-apple' })).not.toThrow();
    expect(() =>
      appleSignInSchema.parse({
        idToken: 'jwt-from-apple',
        fullName: { givenName: 'A', familyName: 'B' },
      }),
    ).not.toThrow();
  });

  it('publicUserSchema omits password hash', () => {
    const user = publicUserSchema.parse({
      id: 'clx',
      email: 'a@b.co',
      name: 'A',
      role: 'user',
      emailVerifiedAt: null,
      createdAt: new Date().toISOString(),
    });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('authResponseSchema composes tokens + user', () => {
    expect(() =>
      authResponseSchema.parse({
        accessToken: 'a.b.c',
        refreshToken: 'r'.repeat(30),
        user: {
          id: 'clx',
          email: 'a@b.co',
          name: 'A',
          role: 'user',
          emailVerifiedAt: null,
          createdAt: new Date().toISOString(),
        },
      }),
    ).not.toThrow();
  });
});
