import { prisma } from '@ccc/db';
import { createDsrBodySchema, dsrListQuerySchema, updateDsrBodySchema } from '@ccc/shared/dsr';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

const SLA_DAYS = 15;

const computeDaysRemaining = (dueDate: Date): number => {
  const now = new Date();
  const diff = dueDate.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const encodeCursor = (r: { createdAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ c: r.createdAt.toISOString(), i: r.id })).toString('base64url');

const decodeCursor = (raw: string): { createdAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Record<string, unknown>;
  if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
    throw new Error('malformed cursor payload');
  }
  const createdAt = new Date(parsed.c);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('invalid cursor date');
  }
  return { createdAt, id: parsed.i };
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminDsrRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dsr', async (request, reply) => {
    const { status, cursor, limit } = dsrListQuerySchema.parse(request.query);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    if (cursor) {
      try {
        const { createdAt, id } = decodeCursor(cursor);
        where.AND = [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.dataSubjectRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        user: { select: { id: true, name: true, email: true } },
        resolver: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null;

    return {
      items: items.map((r) => ({
        ...r,
        dueDate: r.dueDate.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        daysRemaining: computeDaysRemaining(r.dueDate),
      })),
      nextCursor,
    };
  });

  app.get('/dsr/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const dsr = await prisma.dataSubjectRequest.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        resolver: { select: { id: true, name: true } },
        actions: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!dsr) {
      return reply.status(404).send({ error: 'NotFound', message: 'DSR not found' });
    }

    return {
      ...dsr,
      dueDate: dsr.dueDate.toISOString(),
      resolvedAt: dsr.resolvedAt?.toISOString() ?? null,
      createdAt: dsr.createdAt.toISOString(),
      updatedAt: dsr.updatedAt.toISOString(),
      actions: dsr.actions.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
      daysRemaining: computeDaysRemaining(dsr.dueDate),
    };
  });

  app.post('/dsr', async (request) => {
    const { sub } = requireUser(request);
    const body = createDsrBodySchema.parse(request.body);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + SLA_DAYS);

    const dsr = await prisma.$transaction(async (tx) => {
      const created = await tx.dataSubjectRequest.create({
        data: {
          userId: body.userId,
          type: body.type,
          status: 'pending_identity',
          identityStatus: 'not_requested',
          description: body.description ?? null,
          dueDate,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          resolver: { select: { id: true, name: true } },
        },
      });

      await tx.dsrAction.create({
        data: {
          dsrId: created.id,
          actorId: sub,
          action: 'created',
          note: body.description ?? null,
        },
      });

      await recordAudit(
        {
          actorId: sub,
          action: 'dsr.create',
          entityType: 'dsr',
          entityId: created.id,
          metadata: { type: body.type, userId: body.userId },
        },
        tx,
      );

      return created;
    });

    return {
      ...dsr,
      dueDate: dsr.dueDate.toISOString(),
      resolvedAt: dsr.resolvedAt?.toISOString() ?? null,
      createdAt: dsr.createdAt.toISOString(),
      updatedAt: dsr.updatedAt.toISOString(),
      daysRemaining: computeDaysRemaining(dsr.dueDate),
    };
  });

  app.patch('/dsr/:id', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const body = updateDsrBodySchema.parse(request.body);

    const existing = await prisma.dataSubjectRequest.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'NotFound', message: 'DSR not found' });
    }

    if (existing.status === 'completed' || existing.status === 'denied') {
      return reply.status(409).send({ error: 'Conflict', message: 'DSR already resolved' });
    }

    const data: Record<string, unknown> = {};
    let auditAction: string | null = null;

    if (body.identityStatus && body.identityStatus !== existing.identityStatus) {
      data.identityStatus = body.identityStatus;
      if (body.identityStatus === 'verified') {
        auditAction = 'dsr.verify_identity';
        if (existing.status === 'pending_identity') {
          data.status = 'open';
        }
      }
    }

    if (body.identityProofKey) data.identityProofKey = body.identityProofKey;
    if (body.evidenceKey) data.evidenceKey = body.evidenceKey;

    if (body.status && body.status !== existing.status) {
      const resolving = body.status === 'completed' || body.status === 'denied';
      const identityVerified = (data.identityStatus ?? existing.identityStatus) === 'verified';

      if (resolving && !identityVerified) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          message: 'Identity must be verified before resolving',
        });
      }

      if (body.status === 'denied' && !body.denialReason) {
        return reply
          .status(422)
          .send({ error: 'UnprocessableEntity', message: 'denialReason is required when denying' });
      }

      data.status = body.status;
      if (body.status === 'in_progress') {
        auditAction = 'dsr.start_processing';
      } else if (body.status === 'completed') {
        auditAction = 'dsr.complete';
        data.resolverId = sub;
        data.resolvedAt = new Date();
      } else if (body.status === 'denied') {
        auditAction = 'dsr.deny';
        data.resolverId = sub;
        data.resolvedAt = new Date();
        data.denialReason = body.denialReason!;
      }
    }

    if (Object.keys(data).length === 0) {
      return reply.status(200).send({ message: 'no changes' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.dataSubjectRequest.update({
        where: { id },
        data,
        include: {
          user: { select: { id: true, name: true, email: true } },
          resolver: { select: { id: true, name: true } },
          actions: { orderBy: { createdAt: 'asc' } },
        },
      });

      const actionNote = body.note ?? body.denialReason ?? null;
      const actionLabel = auditAction?.replace('dsr.', '') ?? Object.keys(data).join(',');

      await tx.dsrAction.create({
        data: {
          dsrId: id,
          actorId: sub,
          action: actionLabel,
          note: actionNote,
          metadata: data as object as Prisma.InputJsonValue,
        },
      });

      await recordAudit(
        {
          actorId: sub,
          action: (auditAction ?? 'dsr.update') as Parameters<typeof recordAudit>[0]['action'],
          entityType: 'dsr',
          entityId: id,
          metadata: data,
        },
        tx,
      );

      return result;
    });

    return {
      ...updated,
      dueDate: updated.dueDate.toISOString(),
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      actions: updated.actions.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
      daysRemaining: computeDaysRemaining(updated.dueDate),
    };
  });
};
