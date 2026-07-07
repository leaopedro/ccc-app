import { prisma } from '@jdm/db';
import {
  adminGrantTicketResponseSchema,
  adminGrantTicketSchema,
  adminTicketsListQuerySchema,
  adminTicketsListResponseSchema,
} from '@jdm/shared/admin';
import type { Prisma, Ticket, TicketTier } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { sendTransactionalPush } from '../../services/push/transactional.js';
import { signTicketCode } from '../../services/tickets/codes.js';
import {
  DuplicateTicketError,
  GrantInputError,
  grantCompTicket,
} from '../../services/tickets/grant.js';

type HolderSelect = { id: string; name: string; email: string };
type TicketWithRelations = Ticket & { user: HolderSelect; tier: TicketTier };

const encodeCursor = (t: Pick<Ticket, 'createdAt' | 'id'>): string =>
  Buffer.from(JSON.stringify({ c: t.createdAt.toISOString(), i: t.id })).toString('base64url');

const decodeCursor = (raw: string): { createdAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { c: string; i: string };
  return { createdAt: new Date(parsed.c), id: parsed.i };
};

const serializeTicketRow = (t: TicketWithRelations, code: string) => ({
  id: t.id,
  holder: {
    id: t.user.id,
    name: t.user.name,
    email: t.user.email,
    avatarUrl: null,
  },
  tier: {
    id: t.tier.id,
    name: t.tier.name,
  },
  extras: [],
  status: t.status,
  source: t.source,
  code,
  usedAt: t.usedAt?.toISOString() ?? null,
  car: null,
  licensePlate: null,
});

// eslint-disable-next-line @typescript-eslint/require-await
export const adminTicketRoutes: FastifyPluginAsync = async (app) => {
  app.post('/tickets/grant', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const input = adminGrantTicketSchema.parse(request.body);

    try {
      const result = await grantCompTicket(
        {
          actorId,
          userId: input.userId,
          eventId: input.eventId,
          tierId: input.tierId,
          ...(input.extras !== undefined && { extras: input.extras }),
          ...(input.carId !== undefined && { carId: input.carId }),
          ...(input.licensePlate !== undefined && { licensePlate: input.licensePlate }),
          ...(input.note !== undefined && { note: input.note }),
        },
        app.env,
      );

      void sendTransactionalPush(
        {
          userId: input.userId,
          kind: 'ticket.confirmed',
          dedupeKey: result.ticketId,
          title: 'Ingresso confirmado',
          body: 'Seu ingresso foi emitido com sucesso.',
          data: { ticketId: result.ticketId },
        },
        { sender: app.push },
      ).catch((err: unknown) => {
        app.log.warn({ err }, 'grant: push notification failed');
      });

      return reply.status(201).send(adminGrantTicketResponseSchema.parse(result));
    } catch (err) {
      if (err instanceof DuplicateTicketError) {
        return reply.status(409).send({ error: 'DuplicateTicket', message: err.message });
      }
      if (err instanceof GrantInputError) {
        return reply.status(422).send({ error: 'InvalidInput', message: err.message });
      }
      throw err;
    }
  });

  app.get('/events/:id/tickets', async (request, reply) => {
    const { id: eventId } = request.params as { id: string };
    const query = adminTicketsListQuerySchema.parse(request.query);

    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) return reply.status(404).send({ error: 'NotFound' });

    const where: Prisma.TicketWhereInput = { eventId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.tier) where.tierId = query.tier;
    if (query.q) {
      where.user = {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      };
    }

    if (query.cursor) {
      try {
        const { createdAt, id } = decodeCursor(query.cursor);
        where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        user: { select: { id: true, name: true, email: true } },
        tier: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return adminTicketsListResponseSchema.parse({
      items: page.map((t) => serializeTicketRow(t, signTicketCode(t.id, app.env))),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });
};
