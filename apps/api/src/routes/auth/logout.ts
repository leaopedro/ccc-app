import { prisma } from '@jdm/db';
import { logoutSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { hashRefreshToken } from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const logoutRoute: FastifyPluginAsync = async (app) => {
  app.post('/logout', async (request, reply) => {
    const { refreshToken } = logoutSchema.parse(request.body);
    const hash = hashRefreshToken(refreshToken, app.env);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.status(200).send({ message: 'logged out' });
  });
};
