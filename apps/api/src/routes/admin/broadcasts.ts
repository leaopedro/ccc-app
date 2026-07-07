import { prisma } from '@jdm/db';
import type { BroadcastSummary, NotificationDestination } from '@jdm/shared';
import {
  broadcastDryRunRequestSchema,
  createBroadcastRequestSchema,
  notificationDestinationSchema,
  updateBroadcastRequestSchema,
} from '@jdm/shared';
import { Prisma, type Broadcast } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { countRecipients } from '../../services/broadcasts/targets.js';

const parseDestination = (raw: Prisma.JsonValue | null): NotificationDestination | null => {
  if (!raw) return null;
  const parsed = notificationDestinationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const serializeSummary = (
  b: Broadcast,
  stats?: { sent: number; failed: number; pending: number },
): BroadcastSummary => ({
  id: b.id,
  title: b.title,
  body: b.body,
  targetKind: b.targetKind,
  targetValue: b.targetValue,
  deliveryMode: b.deliveryMode,
  destination: parseDestination(b.destination),
  status: b.status,
  scheduledAt: b.scheduledAt?.toISOString() ?? null,
  startedAt: b.startedAt?.toISOString() ?? null,
  completedAt: b.completedAt?.toISOString() ?? null,
  createdAt: b.createdAt.toISOString(),
  sentCount: stats?.sent ?? 0,
  failedCount: stats?.failed ?? 0,
  pendingCount: stats?.pending ?? 0,
});

// eslint-disable-next-line @typescript-eslint/require-await
export const adminBroadcastRoutes: FastifyPluginAsync = async (app) => {
  app.post('/broadcasts/dry-run', async (request, reply) => {
    requireUser(request);
    const input = broadcastDryRunRequestSchema.parse(request.body);
    const count = await countRecipients(input.target);
    return reply.send({ estimatedRecipients: count });
  });

  app.post('/broadcasts', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = createBroadcastRequestSchema.parse(request.body);

    const targetValue =
      input.target.kind === 'attendees_of_event'
        ? input.target.eventId
        : input.target.kind === 'city'
          ? input.target.city
          : null;

    let scheduledAt: Date | null = null;
    let status: 'draft' | 'scheduled' = 'draft';
    if (input.sendNow) {
      scheduledAt = new Date();
      status = 'scheduled';
    } else if (input.scheduledAt) {
      scheduledAt = new Date(input.scheduledAt);
      status = 'scheduled';
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        targetKind: input.target.kind,
        targetValue,
        deliveryMode: input.deliveryMode,
        destination: input.destination
          ? (input.destination as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        scheduledAt,
        status,
        createdByAdminId: sub,
      },
    });

    return reply.status(201).send(serializeSummary(broadcast));
  });

  app.get('/broadcasts', async (request, reply) => {
    requireUser(request);
    const broadcasts = await prisma.broadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const ids = broadcasts.map((b) => b.id);
    const deliveryCounts = await prisma.broadcastDelivery.groupBy({
      by: ['broadcastId', 'status'],
      where: { broadcastId: { in: ids } },
      _count: true,
    });

    const statsMap = new Map<string, { sent: number; failed: number; pending: number }>();
    for (const row of deliveryCounts) {
      if (!statsMap.has(row.broadcastId)) {
        statsMap.set(row.broadcastId, { sent: 0, failed: 0, pending: 0 });
      }
      const s = statsMap.get(row.broadcastId)!;
      if (row.status === 'sent') s.sent = row._count;
      else if (row.status === 'failed') s.failed = row._count;
      else if (row.status === 'pending') s.pending = row._count;
    }

    return reply.send({
      broadcasts: broadcasts.map((b) => serializeSummary(b, statsMap.get(b.id))),
    });
  });

  app.get('/broadcasts/:id', async (request, reply) => {
    requireUser(request);
    const { id } = request.params as { id: string };

    const broadcast = await prisma.broadcast.findUnique({ where: { id } });
    if (!broadcast) return reply.notFound();

    const counts = await prisma.broadcastDelivery.groupBy({
      by: ['status'],
      where: { broadcastId: id },
      _count: true,
    });

    const stats = { sent: 0, failed: 0, pending: 0 };
    for (const row of counts) {
      if (row.status === 'sent') stats.sent = row._count;
      else if (row.status === 'failed') stats.failed = row._count;
      else if (row.status === 'pending') stats.pending = row._count;
    }

    return reply.send(serializeSummary(broadcast, stats));
  });

  app.patch('/broadcasts/:id', async (request, reply) => {
    requireUser(request);
    const { id } = request.params as { id: string };
    const input = updateBroadcastRequestSchema.parse(request.body);

    const existing = await prisma.broadcast.findUnique({ where: { id } });
    if (!existing) return reply.notFound();

    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      return reply.badRequest('Only draft or scheduled broadcasts can be edited');
    }

    const targetValue =
      input.target?.kind === 'attendees_of_event'
        ? input.target.eventId
        : input.target?.kind === 'city'
          ? input.target.city
          : input.target
            ? null
            : undefined;

    const data: Prisma.BroadcastUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.data !== undefined) data.data = input.data as Prisma.InputJsonValue;
    if (input.target !== undefined) data.targetKind = input.target.kind;
    if (targetValue !== undefined) data.targetValue = targetValue;
    if (input.deliveryMode !== undefined) data.deliveryMode = input.deliveryMode;
    if (input.destination !== undefined) {
      data.destination = input.destination
        ? (input.destination as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (input.scheduledAt !== undefined) {
      data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      data.status = input.scheduledAt ? 'scheduled' : 'draft';
    }

    const updated = await prisma.broadcast.update({
      where: { id },
      data,
    });

    return reply.send(serializeSummary(updated));
  });

  app.post('/broadcasts/:id/cancel', async (request, reply) => {
    requireUser(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.broadcast.findUnique({ where: { id } });
    if (!existing) return reply.notFound();

    if (existing.status === 'sent' || existing.status === 'processing') {
      return reply.badRequest('Cannot cancel a broadcast that is already sent or processing');
    }

    if (existing.status === 'cancelled') {
      return reply.send(serializeSummary(existing));
    }

    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    return reply.send(serializeSummary(updated));
  });
};
