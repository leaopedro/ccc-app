import { prisma } from '@jdm/db';
import {
  ACCOUNT_DISABLED_ERROR,
  INACTIVE_USER_STATUSES,
  authResponseSchema,
  refreshSchema,
} from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import {
  createAccessToken,
  hashRefreshToken,
  issueRefreshToken,
} from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const refreshRoute: FastifyPluginAsync = async (app) => {
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const hash = hashRefreshToken(refreshToken, app.env);

    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if ((INACTIVE_USER_STATUSES as readonly string[]).includes(user.status)) {
      await prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      return reply
        .status(401)
        .send({ error: ACCOUNT_DISABLED_ERROR, message: 'account is disabled' });
    }

    const next = issueRefreshToken(app.env);
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: next.hash, expiresAt: next.expiresAt },
      }),
    ]);

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);

    return reply.status(200).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: next.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
