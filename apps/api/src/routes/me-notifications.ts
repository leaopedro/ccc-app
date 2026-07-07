import { prisma } from '@jdm/db';
import {
  notificationDestinationSchema,
  notificationListItemSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationMarkReadResponseSchema,
  notificationUnreadCountResponseSchema,
  type NotificationListItem,
} from '@jdm/shared/notifications';
import type { Notification, Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

const serializeNotification = (n: Notification): NotificationListItem => {
  const destinationParsed = n.destination
    ? notificationDestinationSchema.safeParse(n.destination)
    : null;
  return notificationListItemSchema.parse({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    data: (n.data ?? {}) as Record<string, unknown>,
    destination: destinationParsed?.success ? destinationParsed.data : null,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
  });
};

// eslint-disable-next-line @typescript-eslint/require-await
export const meNotificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/notifications', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const { limit, cursor } = notificationListQuerySchema.parse(request.query);

    const where: Prisma.NotificationWhereInput = { userId: sub };
    if (cursor) {
      // cursor encodes the createdAt of the last seen row to keep tie-breaks
      // deterministic via id when timestamps collide.
      const [createdAtIso, lastId] = cursor.split('|');
      const createdAt = createdAtIso ? new Date(createdAtIso) : null;
      if (createdAt && !Number.isNaN(createdAt.getTime())) {
        where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: lastId ?? '' } }];
      }
    }

    const rows = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1]!;
      nextCursor = `${last.createdAt.toISOString()}|${last.id}`;
    }

    return notificationListResponseSchema.parse({
      notifications: rows.slice(0, limit).map(serializeNotification),
      nextCursor,
    });
  });

  app.get('/me/notifications/unread-count', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const unread = await prisma.notification.count({
      where: { userId: sub, readAt: null },
    });
    return notificationUnreadCountResponseSchema.parse({ unread });
  });

  app.post(
    '/me/notifications/:id/read',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { id } = request.params as { id: string };

      const existing = await prisma.notification.findUnique({
        where: { id },
        select: { userId: true, readAt: true },
      });
      if (!existing || existing.userId !== sub) {
        return reply.status(404).send({ error: 'NotFound' });
      }

      const readAt = existing.readAt ?? new Date();
      if (!existing.readAt) {
        await prisma.notification.update({ where: { id }, data: { readAt } });
      }

      return notificationMarkReadResponseSchema.parse({
        id,
        readAt: readAt.toISOString(),
      });
    },
  );
};
