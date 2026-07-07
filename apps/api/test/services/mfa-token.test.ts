import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { createMfaToken, verifyMfaToken } from '../../src/services/auth/tokens.js';

const env = loadEnv();

describe('MFA challenge token', () => {
  it('creates and verifies a valid token', () => {
    const token = createMfaToken('user-123', env);
    const payload = verifyMfaToken(token, env);
    expect(payload.sub).toBe('user-123');
    expect(payload.purpose).toBe('mfa_challenge');
  });

  it('returns a JWT string', () => {
    const token = createMfaToken('user-456', env);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('rejects tampered tokens', () => {
    const token = createMfaToken('user-789', env) + 'x';
    expect(() => verifyMfaToken(token, env)).toThrow();
  });
});
