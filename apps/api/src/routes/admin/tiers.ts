import { prisma } from '@ccc/db';
import { adminTierCreateSchema, adminTierUpdateSchema } from '@ccc/shared/admin';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

import { serializeAdminTier } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminTierRoutes: FastifyPluginAsync = async (app) => {
  app.post('/events/:eventId/tiers', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId } = request.params as { eventId: string };
    const input = adminTierCreateSchema.parse(request.body);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.status(404).send({ error: 'NotFound' });

    const nextSort = input.sortOrder ?? (await prisma.ticketTier.count({ where: { eventId } }));

    const tier = await prisma.ticketTier.create({
      data: {
        eventId,
        name: input.name,
        priceCents: input.priceCents,
        currency: input.currency,
        quantityTotal: input.quantityTotal,
        salesOpenAt: input.salesOpenAt ? new Date(input.salesOpenAt) : null,
        salesCloseAt: input.salesCloseAt ? new Date(input.salesCloseAt) : null,
        sortOrder: nextSort,
        requiresCar: input.requiresCar ?? false,
        isPremiumGrantable: input.isPremiumGrantable,
      },
    });

    await recordAudit({
      actorId: sub,
      action: 'tier.create',
      entityType: 'tier',
      entityId: tier.id,
      metadata: { eventId },
    });

    return reply.status(201).send(serializeAdminTier(tier, app.env.DEV_FEE_PERCENT));
  });

  app.patch('/events/:eventId/tiers/:tierId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, tierId } = request.params as { eventId: string; tierId: string };
    const input = adminTierUpdateSchema.parse(request.body);

    const tier = await prisma.ticketTier.findFirst({ where: { id: tierId, eventId } });
    if (!tier) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.TicketTierUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.quantityTotal !== undefined) data.quantityTotal = input.quantityTotal;
    if (input.salesOpenAt !== undefined)
      data.salesOpenAt = input.salesOpenAt ? new Date(input.salesOpenAt) : null;
    if (input.salesCloseAt !== undefined)
      data.salesCloseAt = input.salesCloseAt ? new Date(input.salesCloseAt) : null;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.requiresCar !== undefined) data.requiresCar = input.requiresCar;
    if (input.isPremiumGrantable !== undefined) data.isPremiumGrantable = input.isPremiumGrantable;

    const updated = await prisma.ticketTier.update({ where: { id: tierId }, data });
    await recordAudit({
      actorId: sub,
      action: 'tier.update',
      entityType: 'tier',
      entityId: tierId,
      metadata: { fields: Object.keys(input) },
    });
    return serializeAdminTier(updated, app.env.DEV_FEE_PERCENT);
  });

  app.delete('/events/:eventId/tiers/:tierId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, tierId } = request.params as { eventId: string; tierId: string };
    const tier = await prisma.ticketTier.findFirst({ where: { id: tierId, eventId } });
    if (!tier) return reply.status(404).send({ error: 'NotFound' });
    await prisma.ticketTier.delete({ where: { id: tierId } });
    await recordAudit({
      actorId: sub,
      action: 'tier.delete',
      entityType: 'tier',
      entityId: tierId,
      metadata: { eventId },
    });
    return reply.status(204).send();
  });
};
