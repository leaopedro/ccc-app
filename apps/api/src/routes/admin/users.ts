import { prisma } from '@jdm/db';
import {
  adminCreateUserBodySchema,
  adminUserCreatedSchema,
  adminUserDetailSchema,
  adminUserRoleChangeBodySchema,
  adminUserRoleChangedSchema,
  adminUserSearchQuerySchema,
  adminUserSearchResponseSchema,
  adminUserStatusUpdatedSchema,
} from '@jdm/shared/admin';
import type { Prisma, User as DbUser } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import type { Uploads } from '../../services/uploads/index.js';

const encodeCursor = (u: Pick<DbUser, 'createdAt' | 'id'>): string =>
  Buffer.from(JSON.stringify({ c: u.createdAt.toISOString(), i: u.id })).toString('base64url');

const decodeCursor = (raw: string): { createdAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as {
    c: string;
    i: string;
  };
  return { createdAt: new Date(parsed.c), id: parsed.i };
};

const avatarUrl = (u: Pick<DbUser, 'avatarObjectKey'>, uploads: Uploads): string | null =>
  u.avatarObjectKey ? uploads.buildPublicUrl(u.avatarObjectKey) : null;

// eslint-disable-next-line @typescript-eslint/require-await
export const adminUserRoutes: FastifyPluginAsync = async (app) => {
  app.get('/users', async (request, reply) => {
    const { q, cursor, limit } = adminUserSearchQuerySchema.parse(request.query);

    const where: Prisma.UserWhereInput = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (cursor) {
      try {
        const { createdAt, id } = decodeCursor(cursor);
        where.AND = [
          {
            OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
          },
        ];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        email: true,
        avatarObjectKey: true,
        status: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return adminUserSearchResponseSchema.parse({
      items: page.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: avatarUrl(u, app.uploads),
        status: u.status,
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });

  app.get('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        bio: true,
        city: true,
        stateCode: true,
        avatarObjectKey: true,
      },
    });
    if (!user) return reply.status(404).send({ error: 'NotFound' });

    const [totalTickets, totalOrders, recentTickets, recentOrders, groupMemberships] =
      await Promise.all([
        prisma.ticket.count({ where: { userId: id } }),
        prisma.order.count({ where: { userId: id } }),
        prisma.ticket.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            source: true,
            createdAt: true,
            event: { select: { title: true } },
          },
        }),
        prisma.order.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            amountCents: true,
            currency: true,
            createdAt: true,
            event: { select: { title: true } },
          },
        }),
        prisma.userGroupMembership.findMany({
          where: { userId: id },
          select: { group: { select: { id: true, name: true } } },
          orderBy: { group: { name: 'asc' } },
        }),
      ]);

    return adminUserDetailSchema.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      bio: user.bio ?? null,
      city: user.city ?? null,
      stateCode: user.stateCode ?? null,
      avatarUrl: avatarUrl(user, app.uploads),
      stats: { totalTickets, totalOrders },
      recentTickets: recentTickets.map((t) => ({
        id: t.id,
        status: t.status,
        source: t.source,
        eventTitle: t.event.title,
        createdAt: t.createdAt.toISOString(),
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        status: o.status,
        amountCents: o.amountCents,
        currency: o.currency,
        eventTitle: o.event?.title ?? '',
        createdAt: o.createdAt.toISOString(),
      })),
      groups: groupMemberships.map((m) => ({ id: m.group.id, name: m.group.name })),
    });
  });
};

// Admin-only mutation routes: create / disable / enable users.
// Registered under requireRole('admin') in admin/index.ts.
// eslint-disable-next-line @typescript-eslint/require-await
export const adminUserMutationRoutes: FastifyPluginAsync = async (app) => {
  app.post('/users', async (request, reply) => {
    const { email } = adminCreateUserBodySchema.parse(request.body);
    const actor = requireUser(request);

    try {
      const user = await prisma.user.create({
        data: {
          email,
          name: email,
          status: 'partial',
          passwordHash: null,
          emailVerifiedAt: null,
          role: 'user',
        },
        select: { id: true, email: true, status: true, createdAt: true },
      });

      await recordAudit({
        actorId: actor.sub,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        metadata: { email: user.email },
      });
      app.log.info(
        { actorId: actor.sub, targetId: user.id, action: 'user.create' },
        'admin user created',
      );

      return reply.status(201).send(
        adminUserCreatedSchema.parse({
          id: user.id,
          email: user.email,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        }),
      );
    } catch (err) {
      if (err instanceof PrismaNS.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'email already exists' });
      }
      throw err;
    }
  });

  app.patch('/users/:id/role', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = requireUser(request);
    const { role } = adminUserRoleChangeBodySchema.parse(request.body);

    if (id === actor.sub) {
      return reply.status(400).send({ error: 'BadRequest', message: 'cannot change own role' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    if (target.role !== role) {
      await prisma.user.update({ where: { id }, data: { role } });
      await recordAudit({
        actorId: actor.sub,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        metadata: { oldRole: target.role, newRole: role },
      });
      app.log.info(
        { actorId: actor.sub, targetId: id, oldRole: target.role, newRole: role },
        'admin user role changed',
      );
    }

    return reply.status(200).send(adminUserRoleChangedSchema.parse({ id, role }));
  });

  app.post('/users/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = requireUser(request);

    if (id === actor.sub) {
      return reply.status(400).send({ error: 'BadRequest', message: 'cannot disable self' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    if (target.status !== 'disabled') {
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { status: 'disabled' } }),
        prisma.refreshToken.deleteMany({ where: { userId: id } }),
      ]);
      await recordAudit({
        actorId: actor.sub,
        action: 'user.disable',
        entityType: 'user',
        entityId: id,
      });
      app.log.info(
        { actorId: actor.sub, targetId: id, action: 'user.disable' },
        'admin user disabled',
      );
    }

    return reply.status(200).send(adminUserStatusUpdatedSchema.parse({ id, status: 'disabled' }));
  });

  app.post('/users/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = requireUser(request);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, passwordHash: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    const next = target.passwordHash ? 'active' : 'partial';
    if (target.status !== next) {
      await prisma.user.update({ where: { id }, data: { status: next } });
      await recordAudit({
        actorId: actor.sub,
        action: 'user.enable',
        entityType: 'user',
        entityId: id,
        metadata: { newStatus: next },
      });
      app.log.info(
        { actorId: actor.sub, targetId: id, action: 'user.enable', newStatus: next },
        'admin user enabled',
      );
    }

    return reply.status(200).send(adminUserStatusUpdatedSchema.parse({ id, status: next }));
  });
};
