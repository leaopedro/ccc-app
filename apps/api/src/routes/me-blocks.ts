import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { requireUser } from '../plugins/auth.js';

const userIdParam = z.object({ userId: z.string().min(1) });

/**
 * User-to-user blocks (App Store guideline 1.2).
 *
 * PUT rather than POST because blocking twice must not be an error: the mobile
 * sheet can fire twice on a double tap, and the user's intent is a state, not an
 * event.
 */
export const meBlocksRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    // hook: 'preHandler' is required, not cosmetic. The default onRequest hook
    // runs BEFORE the route's authenticate preHandler, so req.user is undefined
    // and the key silently degrades to req.ip — which on carrier NAT lets one
    // abusive client lock out every other user behind the same address. Same
    // reasoning as me-documents.ts.
    hook: 'preHandler',
    keyGenerator: (req) => req.user?.sub ?? req.ip,
  });

  app.put('/api/me/blocks/:userId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { userId } = userIdParam.parse(request.params);

    if (userId === sub) {
      return reply
        .status(422)
        .send({ error: 'UnprocessableEntity', message: 'cannot block yourself' });
    }

    const target = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound', message: 'user not found' });

    try {
      await prisma.userBlock.create({ data: { blockerId: sub, blockedId: userId } });
    } catch (err) {
      // Already blocked. Idempotent by design.
      if (!isUniqueConstraintError(err)) throw err;
    }

    return reply.status(204).send();
  });

  app.delete(
    '/api/me/blocks/:userId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { userId } = userIdParam.parse(request.params);

      await prisma.userBlock.deleteMany({ where: { blockerId: sub, blockedId: userId } });

      return reply.status(204).send();
    },
  );

  app.get('/api/me/blocks', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);

    const rows = await prisma.userBlock.findMany({
      where: { blockerId: sub },
      select: { blockedId: true },
      orderBy: { createdAt: 'desc' },
    });

    // Only what THIS user blocked. Deliberately not the symmetric set: telling
    // someone who blocked them would itself be a harassment vector.
    return reply.status(200).send({ blockedUserIds: rows.map((r) => r.blockedId) });
  });
};
