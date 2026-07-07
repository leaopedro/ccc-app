import { prisma } from '@jdm/db';
import { adminUserCreatedSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('POST /admin/users', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { email: 'new@jdm.test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for organizer role', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { email: 'new@jdm.test' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 for staff role', async () => {
    const { user } = await createUser({ email: 's@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
      payload: { email: 'new@jdm.test' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates a partial user', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { email: 'NEW@jdm.test' },
    });
    expect(res.statusCode).toBe(201);
    const body = adminUserCreatedSchema.parse(res.json());
    expect(body.email).toBe('new@jdm.test');
    expect(body.status).toBe('partial');

    const row = await prisma.user.findUnique({ where: { id: body.id } });
    expect(row?.passwordHash).toBeNull();
    expect(row?.emailVerifiedAt).toBeNull();
    expect(row?.status).toBe('partial');
    expect(row?.role).toBe('user');
  });

  it('409 on duplicate email', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    await createUser({ email: 'taken@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { email: 'taken@jdm.test' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('400 on invalid email body', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes admin audit row', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { email: 'audit@jdm.test' },
    });
    expect(res.statusCode).toBe(201);
    const created = adminUserCreatedSchema.parse(res.json());

    const audits = await prisma.adminAudit.findMany({
      where: { action: 'user.create', entityId: created.id },
    });
    expect(audits.length).toBe(1);
    expect(audits[0]!.actorId).toBe(admin.id);
  });
});
