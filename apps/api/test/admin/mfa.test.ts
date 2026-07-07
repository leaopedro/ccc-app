import { prisma } from '@jdm/db';
import { mfaSetupResponseSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { TOTP, Secret } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { decryptSecret } from '../../src/services/auth/mfa.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const makeTotpCode = async (userId: string): Promise<string> => {
  const mfaSecret = await prisma.mfaSecret.findUniqueOrThrow({ where: { userId } });
  const rawSecret = decryptSecret(mfaSecret.encryptedSecret, env.MFA_ENCRYPTION_KEY!);
  const totp = new TOTP({
    secret: Secret.fromBase32(rawSecret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  return totp.generate();
};

describe('Admin MFA routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /admin/mfa/status', () => {
    it('returns enabled:false when no MFA enrolled', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/mfa/status',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false });
    });
  });

  describe('POST /admin/mfa/setup', () => {
    it('returns otpauth URI and 10 recovery codes', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = mfaSetupResponseSchema.parse(res.json());
      expect(body.otpauthUri).toContain('otpauth://totp/');
      expect(body.recoveryCodes).toHaveLength(10);
    });

    it('rejects regular users (403)', async () => {
      const { user } = await createUser({ email: 'user@jdm.test', verified: true, role: 'user' });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'user') },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /admin/mfa/verify-setup', () => {
    it('confirms enrollment with valid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });

      const code = await makeTotpCode(user.id);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code },
      });
      expect(res.statusCode).toBe(200);

      const updated = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      expect(updated!.verifiedAt).not.toBeNull();
    });

    it('rejects invalid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: '000000' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /admin/mfa/recovery-codes', () => {
    const enrollAndVerify = async (user: { id: string }, role: 'admin' | 'organizer' | 'staff') => {
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, role) },
      });
      const code = await makeTotpCode(user.id);
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, role) },
        payload: { code },
      });
    };

    it('regenerates recovery codes with valid TOTP proof', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await enrollAndVerify(user, 'admin');

      const oldCodes = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
      expect(oldCodes).toHaveLength(10);

      const code = await makeTotpCode(user.id);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/recovery-codes',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code },
      });
      expect(res.statusCode).toBe(200);
      const body = mfaSetupResponseSchema.pick({ recoveryCodes: true }).parse(res.json());
      expect(body.recoveryCodes).toHaveLength(10);

      const newCodes = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
      expect(newCodes).toHaveLength(10);
      const oldIds = oldCodes.map((c) => c.id).sort();
      const newIds = newCodes.map((c) => c.id).sort();
      expect(newIds).not.toEqual(oldIds);
    });

    it('rejects without valid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await enrollAndVerify(user, 'admin');

      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/recovery-codes',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: '000000' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /admin/mfa', () => {
    it('disables MFA with valid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      const code1 = await makeTotpCode(user.id);
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: code1 },
      });

      const code2 = await makeTotpCode(user.id);
      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/mfa',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: code2 },
      });
      expect(res.statusCode).toBe(200);
      const deleted = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      expect(deleted).toBeNull();
    });
  });
});
