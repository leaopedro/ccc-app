import { prisma } from '@jdm/db';
import { mfaChallengeResponseSchema } from '@jdm/shared/auth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
} from '../../src/services/auth/mfa.js';
import { issueRefreshToken } from '../../src/services/auth/tokens.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedRefresh = async (userId: string) => {
  const issued = issueRefreshToken(env);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: issued.hash, expiresAt: issued.expiresAt },
  });
  return issued.token;
};

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

describe('deleted / anonymized user auth guards', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deleted user gets 401 AccountDisabled on authed endpoint', async () => {
    const { user } = await createUser({ email: 'del@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('anonymized user gets 401 AccountDisabled on authed endpoint', async () => {
    const { user } = await createUser({ email: 'anon@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'anonymized', anonymizedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('deleted user cannot login', async () => {
    const { user, password } = await createUser({ email: 'del@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'del@jdm.test', password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('anonymized user cannot login', async () => {
    const { user, password } = await createUser({ email: 'anon@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'anonymized', anonymizedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'anon@jdm.test', password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('deleted user skipped by tryAuth (returns anonymous)', async () => {
    const { user } = await createUser({ email: 'del@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(200);
  });

  it('forgot-password does not send email for deleted user', async () => {
    const { user } = await createUser({ email: 'del@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'del@jdm.test' },
    });
    expect(res.statusCode).toBe(200);

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.length).toBe(0);
  });

  it('broadcast targets exclude deleted users', async () => {
    const { user } = await createUser({ email: 'del@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const activeUsers = await prisma.user.findMany({
      where: { status: 'active', role: 'user' },
    });
    const ids = activeUsers.map((u) => u.id);
    expect(ids).not.toContain(user.id);
  });

  it('deleted user cannot refresh token', async () => {
    const { user } = await createUser({ email: 'del@jdm.test', verified: true });
    const token = await seedRefresh(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });

    const tokens = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: { not: null } },
    });
    expect(tokens.length).toBe(1);
  });

  it('anonymized user cannot refresh token', async () => {
    const { user } = await createUser({ email: 'anon@jdm.test', verified: true });
    const token = await seedRefresh(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'anonymized', anonymizedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('deleted user cannot use mfa recovery (code not consumed)', async () => {
    const { user, password } = await createUser({
      email: 'del@jdm.test',
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

    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/recovery',
      payload: { mfaToken, code: codes[0] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });

    const unused = await prisma.mfaRecoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
    });
    expect(unused.length).toBe(codes.length);
  });

  it('deletedAt and anonymizedAt are null for active users', async () => {
    const { user } = await createUser({ email: 'active@jdm.test', verified: true });
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { deletedAt: true, anonymizedAt: true, status: true },
    });
    expect(row?.status).toBe('active');
    expect(row?.deletedAt).toBeNull();
    expect(row?.anonymizedAt).toBeNull();
  });

  describe('DB lifecycle check constraints', () => {
    it('rejects deleted status without deletedAt', async () => {
      const { user } = await createUser({ email: 'c1@jdm.test', verified: true });
      await expect(
        prisma.user.update({
          where: { id: user.id },
          data: { status: 'deleted' },
        }),
      ).rejects.toThrow(/User_deleted_requires_deletedAt/);
    });

    it('rejects anonymized status without anonymizedAt', async () => {
      const { user } = await createUser({ email: 'c2@jdm.test', verified: true });
      await expect(
        prisma.user.update({
          where: { id: user.id },
          data: { status: 'anonymized' },
        }),
      ).rejects.toThrow(/User_anonymized_requires_anonymizedAt/);
    });

    it('rejects deletedAt on active user', async () => {
      const { user } = await createUser({ email: 'c3@jdm.test', verified: true });
      await expect(
        prisma.user.update({
          where: { id: user.id },
          data: { deletedAt: new Date() },
        }),
      ).rejects.toThrow(/User_deletedAt_requires_deleted_status/);
    });

    it('rejects anonymizedAt on active user', async () => {
      const { user } = await createUser({ email: 'c4@jdm.test', verified: true });
      await expect(
        prisma.user.update({
          where: { id: user.id },
          data: { anonymizedAt: new Date() },
        }),
      ).rejects.toThrow(/User_anonymizedAt_requires_anonymized_status/);
    });

    it('allows valid deleted state', async () => {
      const { user } = await createUser({ email: 'c5@jdm.test', verified: true });
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      const row = await prisma.user.findUnique({ where: { id: user.id } });
      expect(row?.status).toBe('deleted');
      expect(row?.deletedAt).not.toBeNull();
    });

    it('allows valid anonymized state', async () => {
      const { user } = await createUser({ email: 'c6@jdm.test', verified: true });
      const now = new Date();
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'anonymized', deletedAt: now, anonymizedAt: now },
      });
      const row = await prisma.user.findUnique({ where: { id: user.id } });
      expect(row?.status).toBe('anonymized');
      expect(row?.anonymizedAt).not.toBeNull();
    });
  });
});
