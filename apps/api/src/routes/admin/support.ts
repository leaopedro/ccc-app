import { prisma } from '@jdm/db';
import {
  adminSupportTicketDetailSchema,
  adminSupportTicketListResponseSchema,
  updateInternalStatusBodySchema,
} from '@jdm/shared/support';
import type { SupportTicket } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { decryptField } from '../../services/crypto/field-encryption.js';
import type { Uploads } from '../../services/uploads/index.js';

const listQuerySchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  cursor: z.string().optional(),
  limit: z.number({ coerce: true }).int().min(1).max(100).default(50),
});

const encodeCursor = (t: Pick<SupportTicket, 'createdAt' | 'id'>): string =>
  Buffer.from(JSON.stringify({ c: t.createdAt.toISOString(), i: t.id })).toString('base64url');

const decodeCursor = (raw: string): { createdAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as {
    c: string;
    i: string;
  };
  return { createdAt: new Date(parsed.c), id: parsed.i };
};

const attachmentUrl = (
  t: Pick<SupportTicket, 'attachmentObjectKey'>,
  uploads: Uploads,
): Promise<string | null> =>
  t.attachmentObjectKey ? uploads.buildSignedGetUrl(t.attachmentObjectKey) : Promise.resolve(null);

// eslint-disable-next-line @typescript-eslint/require-await
export const adminSupportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/support', async (request, reply) => {
    const { status, cursor, limit } = listQuerySchema.parse(request.query);

    const where: {
      status?: 'open' | 'closed';
      AND?: Array<{
        OR: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
      }>;
    } = {};

    if (status) {
      where.status = status;
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

    const rows = await prisma.supportTicket.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        phone: true,
        message: true,
        attachmentObjectKey: true,
        status: true,
        internalStatus: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return adminSupportTicketListResponseSchema.parse({
      items: await Promise.all(
        page.map(async (t) => ({
          id: t.id,
          phone: t.phone,
          message: decryptField(t.message, app.env.FIELD_ENCRYPTION_KEY) ?? t.message,
          attachmentUrl: await attachmentUrl(t, app.uploads),
          status: t.status,
          internalStatus: t.internalStatus,
          createdAt: t.createdAt.toISOString(),
          user: t.user,
        })),
      ),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });

  app.get('/support/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        message: true,
        attachmentObjectKey: true,
        status: true,
        internalStatus: true,
        createdAt: true,
        closedAt: true,
        closedByAdminId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!ticket) {
      return reply.status(404).send({ error: 'NotFound' });
    }

    return adminSupportTicketDetailSchema.parse({
      id: ticket.id,
      phone: ticket.phone,
      message: decryptField(ticket.message, app.env.FIELD_ENCRYPTION_KEY) ?? ticket.message,
      attachmentUrl: await attachmentUrl(ticket, app.uploads),
      status: ticket.status,
      internalStatus: ticket.internalStatus,
      createdAt: ticket.createdAt.toISOString(),
      closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
      closedByAdminId: ticket.closedByAdminId,
      user: ticket.user,
    });
  });

  app.patch('/support/:id/close', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        message: true,
        attachmentObjectKey: true,
        status: true,
        internalStatus: true,
        createdAt: true,
        closedAt: true,
        closedByAdminId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'NotFound' });
    }

    if (existing.status === 'closed') {
      return adminSupportTicketDetailSchema.parse({
        id: existing.id,
        phone: existing.phone,
        message: decryptField(existing.message, app.env.FIELD_ENCRYPTION_KEY) ?? existing.message,
        attachmentUrl: await attachmentUrl(existing, app.uploads),
        status: existing.status,
        internalStatus: existing.internalStatus,
        createdAt: existing.createdAt.toISOString(),
        closedAt: existing.closedAt ? existing.closedAt.toISOString() : null,
        closedByAdminId: existing.closedByAdminId,
        user: existing.user,
      });
    }

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closedByAdminId: sub,
      },
      select: {
        id: true,
        phone: true,
        message: true,
        attachmentObjectKey: true,
        status: true,
        internalStatus: true,
        createdAt: true,
        closedAt: true,
        closedByAdminId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await recordAudit({
      actorId: sub,
      action: 'support.ticket.close',
      entityType: 'support_ticket',
      entityId: updated.id,
    });

    return adminSupportTicketDetailSchema.parse({
      id: updated.id,
      phone: updated.phone,
      message: decryptField(updated.message, app.env.FIELD_ENCRYPTION_KEY) ?? updated.message,
      attachmentUrl: await attachmentUrl(updated, app.uploads),
      status: updated.status,
      internalStatus: updated.internalStatus,
      createdAt: updated.createdAt.toISOString(),
      closedAt: updated.closedAt ? updated.closedAt.toISOString() : null,
      closedByAdminId: updated.closedByAdminId,
      user: updated.user,
    });
  });

  app.patch('/support/:id/internal-status', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const { internalStatus } = updateInternalStatusBodySchema.parse(request.body);

    const existing = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'NotFound' });
    }

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: { internalStatus },
      select: {
        id: true,
        phone: true,
        message: true,
        attachmentObjectKey: true,
        status: true,
        internalStatus: true,
        createdAt: true,
        closedAt: true,
        closedByAdminId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await recordAudit({
      actorId: sub,
      action: 'support.ticket.internal_status_update',
      entityType: 'support_ticket',
      entityId: updated.id,
    });

    return adminSupportTicketDetailSchema.parse({
      id: updated.id,
      phone: updated.phone,
      message: decryptField(updated.message, app.env.FIELD_ENCRYPTION_KEY) ?? updated.message,
      attachmentUrl: await attachmentUrl(updated, app.uploads),
      status: updated.status,
      internalStatus: updated.internalStatus,
      createdAt: updated.createdAt.toISOString(),
      closedAt: updated.closedAt ? updated.closedAt.toISOString() : null,
      closedByAdminId: updated.closedByAdminId,
      user: updated.user,
    });
  });
};
