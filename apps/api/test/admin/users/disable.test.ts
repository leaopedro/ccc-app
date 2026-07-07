import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('POST /admin/users/:id/disable', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/users/x/disable' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for organizer', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/disable`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 cannot disable self', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${admin.id}/disable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 unknown user', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/does-not-exist/disable',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('flips status to disabled and deletes refresh tokens', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    await prisma.refreshToken.create({
      data: {
        userId: target.id,
        tokenHash: 'h1',
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await prisma.refreshToken.create({
      data: {
        userId: target.id,
        tokenHash: 'h2',
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/disable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row?.status).toBe('disabled');
    const tokens = await prisma.refreshToken.findMany({ where: { userId: target.id } });
    expect(tokens.length).toBe(0);
  });

  it('disabled user gets 401 AccountDisabled on authed call', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });

    await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/disable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), target.id, 'user') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'AccountDisabled' });
  });

  it('idempotent on already-disabled user', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });

    const a = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/disable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/disable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(b.statusCode).toBe(200);

    const audits = await prisma.adminAudit.findMany({
      where: { action: 'user.disable', entityId: target.id },
    });
    expect(audits.length).toBe(1);
  });
});
