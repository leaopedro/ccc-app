import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { issuePasswordResetToken } from '../../src/services/auth/password-reset.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/reset-password', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('resets the password and revokes all refresh tokens', async () => {
    const { user, password } = await createUser({ email: 'r@jdm.test', verified: true });
    const token = await issuePasswordResetToken(user.id);

    await prisma.refreshToken.createMany({
      data: [
        {
          userId: user.id,
          tokenHash: `pre-${user.id}-a`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
        {
          userId: user.id,
          tokenHash: `pre-${user.id}-b`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'a-brand-new-passphrase' },
    });
    expect(res.statusCode).toBe(200);

    const liveRefresh = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(liveRefresh).toBe(0);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'a-brand-new-passphrase' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects reused tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await issuePasswordResetToken(user.id);
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'a-brand-new-passphrase' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'another-passphrase-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects expired tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await issuePasswordResetToken(user.id);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'a-brand-new-passphrase' },
    });
    expect(res.statusCode).toBe(400);
  });
});
