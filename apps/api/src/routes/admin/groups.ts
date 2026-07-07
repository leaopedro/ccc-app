import { prisma } from '@jdm/db';
import {
  adminGroupAddMemberSchema,
  adminGroupCreateSchema,
  adminGroupDetailSchema,
  adminGroupListResponseSchema,
  adminGroupMembersResponseSchema,
  adminGroupUpdateSchema,
} from '@jdm/shared/admin';
import { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

type CursorSource = { createdAt: Date; id: string };

const encodeCursor = (row: CursorSource): string =>
  Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString('base64url');

const decodeCursor = (raw: string): { createdAt: Date; id: string } | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { c, i } = parsed as Record<string, unknown>;
    if (typeof c !== 'string' || typeof i !== 'string' || !i) return null;
    const createdAt = new Date(c);
    if (isNaN(createdAt.getTime())) return null;
    return { createdAt, id: i };
  } catch {
    return null;
  }
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminGroupRoutes: FastifyPluginAsync = async (app) => {
  // POST /admin/groups
  app.post('/groups', async (request, reply) => {
    const body = adminGroupCreateSchema.parse(request.body);
    const actor = requireUser(request);

    const group = await prisma.userGroup.create({
      data: { name: body.name, description: body.description },
    });

    await recordAudit({
      actorId: actor.sub,
      action: 'group.create',
      entityType: 'user_group',
      entityId: group.id,
      metadata: { name: group.name },
    });

    app.log.info(
      { actorId: actor.sub, groupId: group.id, action: 'group.create' },
      'group created',
    );

    return reply.status(201).send(
      adminGroupDetailSchema.parse({
        id: group.id,
        name: group.name,
        description: group.description,
        memberCount: 0,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      }),
    );
  });

  // GET /admin/groups
  app.get('/groups', async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const where: Prisma.UserGroupWhereInput = {};

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded)
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      const { createdAt, id } = decoded;
      where.AND = [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
    }

    const groups = await prisma.userGroup.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { _count: { select: { memberships: true } } },
    });

    const hasMore = groups.length > limit;
    const page = hasMore ? groups.slice(0, limit) : groups;
    const last = page[page.length - 1];

    return adminGroupListResponseSchema.parse({
      items: page.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        memberCount: g._count.memberships,
        createdAt: g.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });

  // GET /admin/groups/:groupId
  app.get('/groups/:groupId', async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const group = await prisma.userGroup.findUnique({
      where: { id: groupId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!group) return reply.status(404).send({ error: 'NotFound' });

    return adminGroupDetailSchema.parse({
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group._count.memberships,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    });
  });

  // PATCH /admin/groups/:groupId
  app.patch('/groups/:groupId', async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const body = adminGroupUpdateSchema.parse(request.body);
    const actor = requireUser(request);

    const existing = await prisma.userGroup.findUnique({ where: { id: groupId } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const data: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;

    const group = await prisma.userGroup.update({
      where: { id: groupId },
      data,
      include: { _count: { select: { memberships: true } } },
    });

    await recordAudit({
      actorId: actor.sub,
      action: 'group.update',
      entityType: 'user_group',
      entityId: group.id,
      metadata: body,
    });

    app.log.info(
      { actorId: actor.sub, groupId: group.id, action: 'group.update' },
      'group updated',
    );

    return adminGroupDetailSchema.parse({
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group._count.memberships,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    });
  });

  // GET /admin/groups/:groupId/members
  app.get('/groups/:groupId/members', async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    const group = await prisma.userGroup.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!group) return reply.status(404).send({ error: 'NotFound' });

    const where: Prisma.UserGroupMembershipWhereInput = { groupId };
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded)
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      const { createdAt, id } = decoded;
      where.AND = [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
    }

    const memberships = await prisma.userGroupMembership.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const hasMore = memberships.length > limit;
    const page = hasMore ? memberships.slice(0, limit) : memberships;
    const last = page[page.length - 1];

    return adminGroupMembersResponseSchema.parse({
      items: page.map((m) => ({
        id: m.id,
        userId: m.user.id,
        userName: m.user.name,
        userEmail: m.user.email,
        joinedAt: m.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });

  // POST /admin/groups/:groupId/members
  app.post('/groups/:groupId/members', async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const { userId } = adminGroupAddMemberSchema.parse(request.body);
    const actor = requireUser(request);

    const [group, user] = await Promise.all([
      prisma.userGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!group) return reply.status(404).send({ error: 'NotFound', message: 'group not found' });
    if (!user) return reply.status(404).send({ error: 'NotFound', message: 'user not found' });

    try {
      const membership = await prisma.userGroupMembership.create({
        data: { groupId, userId },
      });

      await recordAudit({
        actorId: actor.sub,
        action: 'group.add_member',
        entityType: 'user_group_membership',
        entityId: membership.id,
        metadata: { groupId, userId },
      });

      app.log.info(
        { actorId: actor.sub, groupId, userId, action: 'group.add_member' },
        'member added to group',
      );

      return reply.status(201).send({ id: membership.id, groupId, userId });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'user already in group' });
      }
      throw err;
    }
  });

  // DELETE /admin/groups/:groupId/members/:userId
  app.delete('/groups/:groupId/members/:userId', async (request, reply) => {
    const { groupId, userId } = request.params as { groupId: string; userId: string };
    const actor = requireUser(request);

    const membership = await prisma.userGroupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) return reply.status(404).send({ error: 'NotFound' });

    await prisma.userGroupMembership.delete({
      where: { id: membership.id },
    });

    await recordAudit({
      actorId: actor.sub,
      action: 'group.remove_member',
      entityType: 'user_group_membership',
      entityId: membership.id,
      metadata: { groupId, userId },
    });

    app.log.info(
      { actorId: actor.sub, groupId, userId, action: 'group.remove_member' },
      'member removed from group',
    );

    return reply.status(204).send();
  });
};
