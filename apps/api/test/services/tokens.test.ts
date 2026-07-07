import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAccessToken,
  hashRefreshToken,
  issueRefreshToken,
  verifyAccessToken,
} from '../../src/services/auth/tokens.js';

const env = {
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
} as const;

describe('access tokens', () => {
  it('round-trips a payload', () => {
    const token = createAccessToken({ sub: 'u_1', role: 'user' }, env);
    const verified = verifyAccessToken(token, env);
    expect(verified.sub).toBe('u_1');
    expect(verified.role).toBe('user');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createAccessToken({ sub: 'u_1', role: 'user' }, env);
    expect(() => verifyAccessToken(token, { ...env, JWT_ACCESS_SECRET: 'z'.repeat(48) })).toThrow();
  });
});

describe('refresh tokens', () => {
  it('issues a high-entropy opaque token', () => {
    const { token, hash, expiresAt } = issueRefreshToken(env);
    expect(token).toHaveLength(43);
    expect(hash).toHaveLength(64);
    const expected = createHmac('sha256', env.REFRESH_TOKEN_PEPPER).update(token).digest('hex');
    expect(hash).toBe(expected);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3_600_000);
  });

  it('hashes deterministically via the pepper', () => {
    const { token, hash } = issueRefreshToken(env);
    expect(hashRefreshToken(token, env)).toBe(hash);
  });
});
