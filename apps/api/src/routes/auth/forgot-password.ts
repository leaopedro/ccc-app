import { prisma } from '@jdm/db';
import { forgotPasswordSchema, INACTIVE_USER_STATUSES } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { resetMail } from '../../services/auth/mail-templates.js';
import { issuePasswordResetToken } from '../../services/auth/password-reset.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const forgotPasswordRoute: FastifyPluginAsync = async (app) => {
  app.post('/forgot-password', async (request, reply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !(INACTIVE_USER_STATUSES as readonly string[]).includes(user.status)) {
      const token = await issuePasswordResetToken(user.id);
      const link = `${app.env.APP_WEB_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await app.mailer.send(resetMail(user.email, link));
    }
    return reply.status(200).send({ message: 'if the email exists, a reset link was sent' });
  });
};
