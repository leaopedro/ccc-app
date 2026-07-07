import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('POST /admin/users/:id/enable', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('flips disabled user with passwordHash to active', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    await prisma.user.update({ where: { id: target.id }, data: { status: 'disabled' } });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/enable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: target.id, status: 'active' });

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row?.status).toBe('active');
  });

  it('flips disabled user without passwordHash back to partial', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const target = await prisma.user.create({
      data: {
        email: 'partial@jdm.test',
        name: 'partial@jdm.test',
        passwordHash: null,
        status: 'disabled',
        role: 'user',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/enable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: target.id, status: 'partial' });

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row?.status).toBe('partial');
  });

  it('idempotent on already-active user', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/enable`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const audits = await prisma.adminAudit.findMany({
      where: { action: 'user.enable', entityId: target.id },
    });
    expect(audits.length).toBe(0);
  });

  it('403 organizer cannot enable', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/enable`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(403);
  });
});
