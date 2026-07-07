import { prisma } from '@jdm/db';
import { adminGroupMembersResponseSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('Group membership endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /admin/groups/:groupId/members', () => {
    it('adds a member to group', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });

      const res = await app.inject({
        method: 'POST',
        url: `/admin/groups/${group.id}/members`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
        payload: { userId: member.id },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toHaveProperty('groupId', group.id);
      expect(res.json()).toHaveProperty('userId', member.id);
    });

    it('409 on duplicate membership', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });
      await prisma.userGroupMembership.create({ data: { groupId: group.id, userId: member.id } });

      const res = await app.inject({
        method: 'POST',
        url: `/admin/groups/${group.id}/members`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
        payload: { userId: member.id },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toHaveProperty('message', 'user already in group');
    });

    it('404 when group does not exist', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/groups/nonexistent/members',
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
        payload: { userId: member.id },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toHaveProperty('message', 'group not found');
    });

    it('404 when user does not exist', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });

      const res = await app.inject({
        method: 'POST',
        url: `/admin/groups/${group.id}/members`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
        payload: { userId: 'nonexistent-user-id' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toHaveProperty('message', 'user not found');
    });

    it('writes audit on add', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });

      await app.inject({
        method: 'POST',
        url: `/admin/groups/${group.id}/members`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
        payload: { userId: member.id },
      });

      const audits = await prisma.adminAudit.findMany({
        where: { action: 'group.add_member' },
      });
      expect(audits.length).toBe(1);
      expect(audits[0]!.actorId).toBe(admin.id);
    });
  });

  describe('DELETE /admin/groups/:groupId/members/:userId', () => {
    it('removes a member from group', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });
      await prisma.userGroupMembership.create({ data: { groupId: group.id, userId: member.id } });

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/groups/${group.id}/members/${member.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(204);

      const count = await prisma.userGroupMembership.count({ where: { groupId: group.id } });
      expect(count).toBe(0);
    });

    it('404 when membership does not exist', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/groups/${group.id}/members/${member.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(404);
    });

    it('writes audit on remove', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({ email: 'm@jdm.test', verified: true });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });
      await prisma.userGroupMembership.create({ data: { groupId: group.id, userId: member.id } });

      await app.inject({
        method: 'DELETE',
        url: `/admin/groups/${group.id}/members/${member.id}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });

      const audits = await prisma.adminAudit.findMany({
        where: { action: 'group.remove_member' },
      });
      expect(audits.length).toBe(1);
    });
  });

  describe('GET /admin/groups/:groupId/members', () => {
    it('lists members with user info', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: member } = await createUser({
        email: 'm@jdm.test',
        verified: true,
        name: 'Member',
      });
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });
      await prisma.userGroupMembership.create({ data: { groupId: group.id, userId: member.id } });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/groups/${group.id}/members`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminGroupMembersResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.userName).toBe('Member');
      expect(body.items[0]!.userEmail).toBe('m@jdm.test');
    });

    it('404 when group does not exist', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/groups/nonexistent/members',
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(404);
    });

    it('paginates members', async () => {
      const { user: admin } = await createUser({
        email: 'a@jdm.test',
        verified: true,
        role: 'admin',
      });
      const group = await prisma.userGroup.create({ data: { name: 'Big Group' } });
      for (let i = 0; i < 3; i++) {
        const { user } = await createUser({ email: `u${i}@jdm.test`, verified: true });
        await prisma.userGroupMembership.create({ data: { groupId: group.id, userId: user.id } });
      }

      const res1 = await app.inject({
        method: 'GET',
        url: `/admin/groups/${group.id}/members?limit=2`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      const body1 = adminGroupMembersResponseSchema.parse(res1.json());
      expect(body1.items).toHaveLength(2);
      expect(body1.nextCursor).not.toBeNull();

      const res2 = await app.inject({
        method: 'GET',
        url: `/admin/groups/${group.id}/members?limit=2&cursor=${body1.nextCursor}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      const body2 = adminGroupMembersResponseSchema.parse(res2.json());
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
      const group = await prisma.userGroup.create({ data: { name: 'VIP' } });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/groups/${group.id}/members?cursor=${cursor}`,
        headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('message', 'invalid cursor');
    });
  });
});
