import { prisma } from '@jdm/db';
import { adminExtraCreateSchema, adminExtraUpdateSchema } from '@jdm/shared/admin';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

import { serializeAdminExtra } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminExtraRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events/:eventId/extras', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.status(404).send({ error: 'NotFound' });

    const extras = await prisma.ticketExtra.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
    });
    return { items: extras.map((e) => serializeAdminExtra(e, app.env.DEV_FEE_PERCENT)) };
  });

  app.post('/events/:eventId/extras', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId } = request.params as { eventId: string };
    const input = adminExtraCreateSchema.parse(request.body);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.status(404).send({ error: 'NotFound' });

    const nextSort = input.sortOrder ?? (await prisma.ticketExtra.count({ where: { eventId } }));

    const extra = await prisma.ticketExtra.create({
      data: {
        eventId,
        name: input.name,
        description: input.description ?? null,
        priceCents: input.priceCents,
        currency: input.currency,
        quantityTotal: input.quantityTotal ?? null,
        active: input.active,
        sortOrder: nextSort,
      },
    });

    await recordAudit({
      actorId: sub,
      action: 'extra.create',
      entityType: 'extra',
      entityId: extra.id,
      metadata: { eventId },
    });

    return reply.status(201).send(serializeAdminExtra(extra, app.env.DEV_FEE_PERCENT));
  });

  app.patch('/extras/:extraId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { extraId } = request.params as { extraId: string };
    const input = adminExtraUpdateSchema.parse(request.body);

    const extra = await prisma.ticketExtra.findUnique({ where: { id: extraId } });
    if (!extra) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.TicketExtraUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.quantityTotal !== undefined) data.quantityTotal = input.quantityTotal;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await prisma.ticketExtra.update({ where: { id: extraId }, data });
    await recordAudit({
      actorId: sub,
      action: 'extra.update',
      entityType: 'extra',
      entityId: extraId,
      metadata: { fields: Object.keys(input) },
    });
    return serializeAdminExtra(updated, app.env.DEV_FEE_PERCENT);
  });

  app.delete('/extras/:extraId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { extraId } = request.params as { extraId: string };
    const extra = await prisma.ticketExtra.findUnique({ where: { id: extraId } });
    if (!extra) return reply.status(404).send({ error: 'NotFound' });
    await prisma.ticketExtra.delete({ where: { id: extraId } });
    await recordAudit({
      actorId: sub,
      action: 'extra.delete',
      entityType: 'extra',
      entityId: extraId,
      metadata: { eventId: extra.eventId },
    });
    return reply.status(204).send();
  });
};
