import { prisma } from '@jdm/db';
import { resendVerifySchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { verificationMail } from '../../services/auth/mail-templates.js';
import { issueVerificationToken } from '../../services/auth/verification.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const resendVerifyRoute: FastifyPluginAsync = async (app) => {
  app.post('/resend-verify', async (request, reply) => {
    const { email } = resendVerifySchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const token = await issueVerificationToken(user.id);
      const link = `${app.env.APP_WEB_BASE_URL}/verify?token=${encodeURIComponent(token)}`;
      await app.mailer.send(verificationMail(user.email, link));
    }
    return reply.status(200).send({ message: 'if the email exists, a verification link was sent' });
  });
};
