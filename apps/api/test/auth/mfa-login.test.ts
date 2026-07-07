import { prisma } from '@jdm/db';
import { authResponseSchema, mfaChallengeResponseSchema } from '@jdm/shared/auth';
import type { FastifyInstance } from 'fastify';
import { TOTP, Secret } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
} from '../../src/services/auth/mfa.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const enrollMfa = async (userId: string, email: string) => {
  const mfaKey = env.MFA_ENCRYPTION_KEY!;
  const { secret } = generateTotpSecret(email);
  const encrypted = encryptSecret(secret, mfaKey);
  await prisma.mfaSecret.create({
    data: { userId, encryptedSecret: encrypted, verifiedAt: new Date() },
  });
  const codes = generateRecoveryCodes();
  await prisma.mfaRecoveryCode.createMany({
    data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c, mfaKey) })),
  });
  return { secret, codes };
};

const makeTotpCode = (base32Secret: string): string => {
  const totp = new TOTP({
    secret: Secret.fromBase32(base32Secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.generate();
};

describe('MFA login flow', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /auth/login with MFA enrolled', () => {
    it('returns mfaRequired challenge instead of tokens', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      await enrollMfa(user.id, user.email);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      expect(res.statusCode).toBe(200);
      const body = mfaChallengeResponseSchema.parse(res.json());
      expect(body.mfaRequired).toBe(true);
      expect(body.mfaToken).toBeTruthy();
    });
  });

  describe('POST /auth/mfa/verify', () => {
    it('completes login with valid TOTP code', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { secret } = await enrollMfa(user.id, user.email);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken } = mfaChallengeResponseSchema.parse(loginRes.json());

      const code = makeTotpCode(secret);
      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        payload: { mfaToken, code },
      });
      expect(res.statusCode).toBe(200);
      const body = authResponseSchema.parse(res.json());
      expect(body.user.email).toBe('mfa@jdm.test');
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
    });

    it('rejects invalid TOTP code', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      await enrollMfa(user.id, user.email);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken } = mfaChallengeResponseSchema.parse(loginRes.json());

      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        payload: { mfaToken, code: '000000' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects expired/invalid mfa token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        payload: { mfaToken: 'bogus.token.here', code: '123456' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /auth/mfa/recovery', () => {
    it('completes login with valid recovery code', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { codes } = await enrollMfa(user.id, user.email);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken } = mfaChallengeResponseSchema.parse(loginRes.json());

      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/recovery',
        payload: { mfaToken, code: codes[0] },
      });
      expect(res.statusCode).toBe(200);
      const body = authResponseSchema.parse(res.json());
      expect(body.user.email).toBe('mfa@jdm.test');
    });

    it('marks recovery code as used (single-use)', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { codes } = await enrollMfa(user.id, user.email);
      const usedCode = codes[0];

      const login1 = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken: token1 } = mfaChallengeResponseSchema.parse(login1.json());
      await app.inject({
        method: 'POST',
        url: '/auth/mfa/recovery',
        payload: { mfaToken: token1, code: usedCode },
      });

      const login2 = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken: token2 } = mfaChallengeResponseSchema.parse(login2.json());
      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/recovery',
        payload: { mfaToken: token2, code: usedCode },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid recovery code', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      await enrollMfa(user.id, user.email);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken } = mfaChallengeResponseSchema.parse(loginRes.json());

      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/recovery',
        payload: { mfaToken, code: 'XXXX-YYYY-ZZZZ' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('concurrent redemption of same code: only one succeeds', async () => {
      const { user, password } = await createUser({
        email: 'mfa@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { codes } = await enrollMfa(user.id, user.email);
      const targetCode = codes[0];

      const login1 = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken: token1 } = mfaChallengeResponseSchema.parse(login1.json());

      const login2 = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      const { mfaToken: token2 } = mfaChallengeResponseSchema.parse(login2.json());

      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/auth/mfa/recovery',
          payload: { mfaToken: token1, code: targetCode },
        }),
        app.inject({
          method: 'POST',
          url: '/auth/mfa/recovery',
          payload: { mfaToken: token2, code: targetCode },
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      expect(statuses).toEqual([200, 401]);
    });
  });
});
