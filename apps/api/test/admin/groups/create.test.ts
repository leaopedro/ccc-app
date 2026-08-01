import { prisma } from '@ccc/db';
import { adminGroupDetailSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('POST /admin/groups', () => {
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
      url: '/admin/groups',
      payload: { name: 'VIP' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for staff role', async () => {
    const { user } = await createUser({ email: 's@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
      payload: { name: 'VIP' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates a group as admin', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: 'VIP', description: 'Very important people' },
    });
    expect(res.statusCode).toBe(201);
    const body = adminGroupDetailSchema.parse(res.json());
    expect(body.name).toBe('VIP');
    expect(body.description).toBe('Very important people');
    expect(body.memberCount).toBe(0);
  });

  it('creates a group as organizer', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Crew' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('400 on empty name', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: '' },
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
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: 'Audit Test' },
    });
    expect(res.statusCode).toBe(201);
    const body = adminGroupDetailSchema.parse(res.json());

    const audits = await prisma.adminAudit.findMany({
      where: { action: 'group.create', entityId: body.id },
    });
    expect(audits.length).toBe(1);
    expect(audits[0]!.actorId).toBe(admin.id);
  });
});
