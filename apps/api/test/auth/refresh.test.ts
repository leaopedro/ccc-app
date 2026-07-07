import { prisma } from '@jdm/db';
import { authResponseSchema } from '@jdm/shared/auth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issueRefreshToken } from '../../src/services/auth/tokens.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const seedRefresh = async (userId: string) => {
  const env = loadEnv();
  const issued = issueRefreshToken(env);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: issued.hash, expiresAt: issued.expiresAt },
  });
  return issued.token;
};

describe('POST /auth/refresh', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rotates the refresh token', async () => {
    const { user } = await createUser({ verified: true });
    const original = await seedRefresh(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: original },
    });
    expect(res.statusCode).toBe(200);
    const body = authResponseSchema.parse(res.json());
    expect(body.refreshToken).not.toBe(original);

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(2);
    const revoked = stored.find((r) => r.revokedAt !== null);
    expect(revoked).toBeDefined();
  });

  it('rejects unknown tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'z'.repeat(43) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects revoked tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await seedRefresh(user.id);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects expired tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await seedRefresh(user.id);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not accept the same refresh token twice (rotation)', async () => {
    const { user } = await createUser({ verified: true });
    const token = await seedRefresh(user.id);
    await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: token } });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });
});
