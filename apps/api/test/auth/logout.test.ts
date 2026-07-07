import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issueRefreshToken } from '../../src/services/auth/tokens.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/logout', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('revokes the refresh token', async () => {
    const env = loadEnv();
    const { user } = await createUser({ verified: true });
    const issued = issueRefreshToken(env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: issued.hash, expiresAt: issued.expiresAt },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: issued.token },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(after[0]?.revokedAt).not.toBeNull();
  });

  it('returns 200 for unknown tokens (idempotent)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: 'z'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
  });
});
