import { prisma } from '@jdm/db';
import { adminGroupDetailSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('PATCH /admin/groups/:groupId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('404 for non-existent group', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/groups/nonexistent',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: 'Updated' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('updates group name', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const group = await prisma.userGroup.create({ data: { name: 'Old Name' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/groups/${group.id}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: 'New Name' },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGroupDetailSchema.parse(res.json());
    expect(body.name).toBe('New Name');
  });

  it('updates description to null', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const group = await prisma.userGroup.create({ data: { name: 'G', description: 'old' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/groups/${group.id}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { description: null },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGroupDetailSchema.parse(res.json());
    expect(body.description).toBeNull();
  });

  it('rejects unknown fields (strict)', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const group = await prisma.userGroup.create({ data: { name: 'G' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/groups/${group.id}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: 'OK', unknownField: 'bad' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes audit on update', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const group = await prisma.userGroup.create({ data: { name: 'G' } });

    await app.inject({
      method: 'PATCH',
      url: `/admin/groups/${group.id}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: { name: 'Updated' },
    });

    const audits = await prisma.adminAudit.findMany({
      where: { action: 'group.update', entityId: group.id },
    });
    expect(audits.length).toBe(1);
  });
});
