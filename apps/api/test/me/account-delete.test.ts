import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issueRefreshToken } from '../../src/services/auth/tokens.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /me/account/delete', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('marks user as deleted and revokes refresh tokens', async () => {
    const { user } = await createUser({ email: 'del@jdm.test', verified: true });
    const issued = issueRefreshToken(env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: issued.hash, expiresAt: issued.expiresAt },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/account/delete',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'deletion_scheduled' });

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.status).toBe('deleted');
    expect(updated?.deletedAt).not.toBeNull();
    expect(updated?.tokenInvalidatedAt).not.toBeNull();

    const activeTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeTokens.length).toBe(0);

    const log = await prisma.deletionLog.findUnique({ where: { userId: user.id } });
    expect(log).not.toBeNull();
    expect(log?.completedAt).toBeNull();
  });

  it('is idempotent — deleted user gets 401 from auth middleware', async () => {
    const { user } = await createUser({ email: 'del2@jdm.test', verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });
    await prisma.deletionLog.create({ data: { userId: user.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/me/account/delete',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated request', async () => {
    const res = await app.inject({ method: 'POST', url: '/me/account/delete' });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits after 3 requests from same IP', async () => {
    const users = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        createUser({ email: `rate${i}@jdm.test`, verified: true }),
      ),
    );

    const [u0, u1, u2, u3] = users as [
      (typeof users)[0],
      (typeof users)[0],
      (typeof users)[0],
      (typeof users)[0],
    ];

    for (const u of [u0, u1, u2]) {
      const r = await app.inject({
        method: 'POST',
        url: '/me/account/delete',
        headers: { authorization: bearer(env, u.user.id) },
      });
      expect(r.statusCode).toBe(200);
    }

    const last = await app.inject({
      method: 'POST',
      url: '/me/account/delete',
      headers: { authorization: bearer(env, u3.user.id) },
    });
    expect(last.statusCode).toBe(429);
  });
});
