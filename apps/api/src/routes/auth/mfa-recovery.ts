import { prisma } from '@jdm/db';
import { mfaRecoverySchema } from '@jdm/shared';
import {
  ACCOUNT_DISABLED_ERROR,
  INACTIVE_USER_STATUSES,
  authResponseSchema,
} from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { verifyRecoveryCode } from '../../services/auth/mfa.js';
import {
  createAccessToken,
  issueRefreshToken,
  verifyMfaToken,
} from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const mfaRecoveryRoute: FastifyPluginAsync = async (app) => {
  app.post('/mfa/recovery', async (request, reply) => {
    const input = mfaRecoverySchema.parse(request.body);

    let payload: { sub: string };
    try {
      payload = verifyMfaToken(input.mfaToken, app.env);
    } catch {
      return reply
        .status(401)
        .send({ error: 'Unauthorized', message: 'invalid or expired mfa token' });
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
    });

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

    const codes = await prisma.mfaRecoveryCode.findMany({
      where: { userId: payload.sub, usedAt: null },
    });

    const mfaKey = app.env.MFA_ENCRYPTION_KEY;
    if (!mfaKey) {
      return reply.status(500).send({ error: 'ServerError', message: 'mfa not configured' });
    }

    const matched = codes.find((c) => verifyRecoveryCode(input.code, c.codeHash, mfaKey));
    if (!matched) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid recovery code' });
    }

    const claimed = await prisma.mfaRecoveryCode.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      return reply
        .status(401)
        .send({ error: 'Unauthorized', message: 'recovery code already used' });
    }

    await prisma.adminAudit.create({
      data: {
        actorId: payload.sub,
        action: 'mfa.recovery_code_used',
        entityType: 'user',
        entityId: payload.sub,
        metadata: { recoveryCodeId: matched.id },
      },
    });

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
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
