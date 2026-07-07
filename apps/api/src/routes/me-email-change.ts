import rateLimit from '@fastify/rate-limit';
import { prisma } from '@jdm/db';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import { consumeEmailChangeToken, issueEmailChangeToken } from '../services/auth/email-change.js';
import { emailChangeConfirmMail, emailChangeNotifyMail } from '../services/auth/mail-templates.js';

const initiateSchema = z.object({
  newEmail: z.string().email().toLowerCase(),
});

const verifySchema = z.object({
  token: z.string().min(1),
});

export const meEmailChangeRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, { max: 5, timeWindow: '15 minutes' });

    scoped.post(
      '/me/email-change',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const { newEmail } = initiateSchema.parse(request.body);

        const [currentUser, conflict] = await Promise.all([
          prisma.user.findUnique({ where: { id: sub }, select: { email: true } }),
          prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } }),
        ]);

        if (!currentUser) return reply.status(401).send({ error: 'Unauthorized' });

        if (currentUser.email === newEmail) {
          return reply.status(400).send({ error: 'BadRequest', message: 'same email' });
        }

        if (conflict) {
          return reply.status(409).send({ error: 'Conflict', message: 'email already in use' });
        }

        const token = await issueEmailChangeToken(sub, newEmail);
        const link = `${app.env.APP_WEB_BASE_URL}/verify-email-change?token=${encodeURIComponent(token)}`;
        await app.mailer.send(emailChangeConfirmMail(newEmail, link));

        return reply.status(202).send({ message: 'confirmation email sent' });
      },
    );
  });

  app.post('/me/email-change/verify', async (request, reply) => {
    const { token } = verifySchema.parse(request.body);

    const result = await consumeEmailChangeToken(token);
    if (!result.ok) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid or expired token' });
    }

    try {
      await app.mailer.send(emailChangeNotifyMail(result.oldEmail, result.newEmail));
    } catch {
      request.log.error('failed to send email-change notification to old address');
    }

    return { message: 'email updated' };
  });
};
