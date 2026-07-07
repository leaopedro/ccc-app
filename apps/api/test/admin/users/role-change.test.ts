import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('PATCH /admin/users/:id/role', () => {
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
      method: 'PATCH',
      url: '/admin/users/x/role',
      payload: { role: 'organizer' },
    });
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
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { role: 'organizer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 cannot change own role', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${admin.id}/role`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { role: 'user' },
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
      method: 'PATCH',
      url: '/admin/users/does-not-exist/role',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { role: 'organizer' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 invalid role value', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { role: 'superadmin' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('changes role and records audit trail', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({
      email: 't@jdm.test',
      verified: true,
      role: 'user',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { role: 'organizer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: target.id, role: 'organizer' });

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row?.role).toBe('organizer');

    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'user.role_changed', entityId: target.id },
    });
    expect(audit).toBeTruthy();
    expect(audit?.metadata).toMatchObject({ oldRole: 'user', newRole: 'organizer' });
    expect(audit?.actorId).toBe(admin.id);
  });

  it('idempotent when role unchanged — no duplicate audit entry', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({
      email: 't@jdm.test',
      verified: true,
      role: 'organizer',
    });

    const a = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { role: 'organizer' },
    });
    expect(a.statusCode).toBe(200);

    const audits = await prisma.adminAudit.findMany({
      where: { action: 'user.role_changed', entityId: target.id },
    });
    expect(audits.length).toBe(0);
  });
});
