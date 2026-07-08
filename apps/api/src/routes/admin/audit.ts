import { prisma } from '@ccc/db';
import { adminAuditListQuerySchema } from '@ccc/shared/admin';
import type { FastifyPluginAsync } from 'fastify';

const encodeCursor = (r: { createdAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ c: r.createdAt.toISOString(), i: r.id })).toString('base64url');

const decodeCursor = (raw: string): { createdAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Record<string, unknown>;
  if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
    throw new Error('malformed cursor');
  }
  const createdAt = new Date(parsed.c);
  if (Number.isNaN(createdAt.getTime())) throw new Error('invalid cursor date');
  return { createdAt, id: parsed.i };
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/audit', async (request, reply) => {
    const q = adminAuditListQuerySchema.parse(request.query);

    const where: Record<string, unknown> = {};
    if (q.actorId) where.actorId = q.actorId;
    if (q.action) where.action = q.action;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;

    if (q.dateFrom || q.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (q.dateFrom) createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) createdAt.lte = new Date(q.dateTo);
      where.createdAt = createdAt;
    }

    if (q.cursor) {
      try {
        const { createdAt, id } = decodeCursor(q.cursor);
        where.AND = [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.adminAudit.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });

    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    return {
      items: items.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
    };
  });
};
