import { prisma } from '@jdm/db';
import { adminConsentListQuerySchema } from '@jdm/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

const encodeCursor = (row: { givenAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ g: row.givenAt.toISOString(), i: row.id })).toString('base64url');

const decodeCursor = (raw: string): { givenAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { g: string; i: string };
  return { givenAt: new Date(parsed.g), id: parsed.i };
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminConsentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/consents', async (request, reply) => {
    const { userId, purpose, cursor, limit } = adminConsentListQuerySchema.parse(request.query);

    const where: Prisma.ConsentWhereInput = {};
    if (userId) where.userId = userId;
    if (purpose) where.purpose = purpose;

    if (cursor) {
      try {
        const { givenAt, id } = decodeCursor(cursor);
        where.AND = [
          {
            OR: [{ givenAt: { lt: givenAt } }, { givenAt, id: { lt: id } }],
          },
        ];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.consent.findMany({
      where,
      orderBy: [{ givenAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user?.name ?? null,
        userEmail: r.user?.email ?? null,
        purpose: r.purpose,
        version: r.version,
        givenAt: r.givenAt.toISOString(),
        withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
        channel: r.channel,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  });
};
