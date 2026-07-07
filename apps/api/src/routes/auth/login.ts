import { prisma } from '@jdm/db';
import {
  ACCOUNT_DISABLED_ERROR,
  INACTIVE_USER_STATUSES,
  authResponseSchema,
  loginSchema,
  mfaChallengeResponseSchema,
} from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { verifyPassword } from '../../services/auth/password.js';
import {
  createAccessToken,
  createMfaToken,
  issueRefreshToken,
} from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const loginRoute: FastifyPluginAsync = async (app) => {
  app.post('/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid credentials' });
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid credentials' });
    }

    if ((INACTIVE_USER_STATUSES as readonly string[]).includes(user.status)) {
      return reply
        .status(403)
        .send({ error: ACCOUNT_DISABLED_ERROR, message: 'account is disabled' });
    }

    if (!user.emailVerifiedAt) {
      return reply
        .status(403)
        .send({ error: 'EmailNotVerified', message: 'verify your email first' });
    }

    const mfaSecret = await prisma.mfaSecret.findUnique({
      where: { userId: user.id },
      select: { verifiedAt: true },
    });
    if (mfaSecret?.verifiedAt) {
      const mfaToken = createMfaToken(user.id, app.env);
      return reply
        .status(200)
        .send(mfaChallengeResponseSchema.parse({ mfaRequired: true, mfaToken }));
    }

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);
    const refresh = issueRefreshToken(app.env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });

    return reply.status(200).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: refresh.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt.toISOString(),
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
