import { prisma } from '@ccc/db';
import { adminGroupDetailSchema, adminGroupListResponseSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('GET /admin/groups', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns empty list when no groups', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGroupListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });

  it('lists groups with member count', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
    const group = await prisma.userGroup.create({ data: { name: 'VIP' } });
    await prisma.userGroupMembership.create({ data: { groupId: group.id, userId: member.id } });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/groups',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGroupListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.name).toBe('VIP');
    expect(body.items[0]!.memberCount).toBe(1);
  });

  it('paginates with cursor', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    for (let i = 0; i < 3; i++) {
      await prisma.userGroup.create({ data: { name: `Group ${i}` } });
    }

    const res1 = await app.inject({
      method: 'GET',
      url: '/admin/groups?limit=2',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    const body1 = adminGroupListResponseSchema.parse(res1.json());
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const res2 = await app.inject({
      method: 'GET',
      url: `/admin/groups?limit=2&cursor=${body1.nextCursor}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    const body2 = adminGroupListResponseSchema.parse(res2.json());
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });

  it.each([
    ['garbage', 'not-base64-at-all!!!'],
    ['empty object', Buffer.from('{}').toString('base64url')],
    ['wrong types', Buffer.from(JSON.stringify({ c: 123, i: null })).toString('base64url')],
    [
      'invalid date',
      Buffer.from(JSON.stringify({ c: 'not-a-date', i: 'abc' })).toString('base64url'),
    ],
    [
      'missing id',
      Buffer.from(JSON.stringify({ c: '2024-01-01T00:00:00Z', i: '' })).toString('base64url'),
    ],
  ])('400 on malformed cursor: %s', async (_label, cursor) => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/groups?cursor=${cursor}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('message', 'invalid cursor');
  });
});

describe('GET /admin/groups/:groupId', () => {
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
      method: 'GET',
      url: '/admin/groups/nonexistent',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns group detail with member count', async () => {
    const { user: admin } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const group = await prisma.userGroup.create({
      data: { name: 'Crew', description: 'The crew' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/groups/${group.id}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGroupDetailSchema.parse(res.json());
    expect(body.name).toBe('Crew');
    expect(body.description).toBe('The crew');
    expect(body.memberCount).toBe(0);
  });
});
