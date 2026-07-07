import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issuePasswordResetToken } from '../../src/services/auth/password-reset.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('AccountDisabled flows', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('login returns 403 AccountDisabled for disabled user', async () => {
    const { user, password } = await createUser({
      email: 'd@jdm.test',
      verified: true,
    });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'd@jdm.test', password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('forgot-password is silent for disabled users', async () => {
    const { user } = await createUser({ email: 'd@jdm.test', verified: true });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'd@jdm.test' },
    });
    expect(res.statusCode).toBe(200);

    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokens.length).toBe(0);
  });

  it('reset-password flips partial user to active and sets emailVerifiedAt', async () => {
    const target = await prisma.user.create({
      data: {
        email: 'partial@jdm.test',
        name: 'partial@jdm.test',
        passwordHash: null,
        status: 'partial',
        role: 'user',
      },
    });
    const token = await issuePasswordResetToken(target.id);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'new-strong-password-123' },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row?.status).toBe('active');
    expect(row?.passwordHash).not.toBeNull();
    expect(row?.emailVerifiedAt).not.toBeNull();
  });

  it('reset-password leaves active user verifiedAt untouched', async () => {
    const verified = new Date('2026-01-01T00:00:00Z');
    const target = await prisma.user.create({
      data: {
        email: 'active@jdm.test',
        name: 'a',
        passwordHash: 'old-hash-doesnt-matter',
        status: 'active',
        role: 'user',
        emailVerifiedAt: verified,
      },
    });
    const token = await issuePasswordResetToken(target.id);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'new-strong-password-123' },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row?.status).toBe('active');
    expect(row?.emailVerifiedAt?.getTime()).toBe(verified.getTime());
  });

  it('disabled-then-authed call returns 401 AccountDisabled', async () => {
    const { user } = await createUser({ email: 'd@jdm.test', verified: true });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('tryAuth treats disabled user as anonymous', async () => {
    const testApp = await makeApp();
    testApp.get(
      '/test-tryauth',
      { preHandler: [testApp.tryAuth] },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (request) => ({ authed: !!request.user }),
    );
    await testApp.ready();

    const { user } = await createUser({ email: 'try@jdm.test', verified: true });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });

    const res = await testApp.inject({
      method: 'GET',
      url: '/test-tryauth',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authed: false });
    await testApp.close();
  });
});
