import rateLimit from '@fastify/rate-limit';
import { consentPurposeSchema, grantConsentBodySchema } from '@jdm/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { listUserConsents, recordConsent, withdrawConsent } from '../services/consent.js';

export const meConsentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/consents', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const records = await listUserConsents(sub);
    return {
      items: records.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        version: r.version,
        givenAt: r.givenAt.toISOString(),
        withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
        channel: r.channel,
      })),
    };
  });

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, { max: 20, timeWindow: '1 minute' });

    scoped.post('/me/consents', { preHandler: [scoped.authenticate] }, async (request) => {
      const { sub, role } = requireUser(request);
      const body = grantConsentBodySchema.parse(request.body);
      const channel = role !== 'user' ? 'web_admin' : 'mobile';

      const row = await recordConsent({
        userId: sub,
        purpose: body.purpose,
        version: body.version,
        channel,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        evidence: body.evidence as Prisma.InputJsonValue,
      });

      return {
        id: row.id,
        purpose: row.purpose,
        version: row.version,
        givenAt: row.givenAt.toISOString(),
        withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
        channel: row.channel,
      };
    });

    scoped.delete(
      '/me/consents/:purpose',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const { purpose } = request.params as { purpose: string };

        const parsed = consentPurposeSchema.safeParse(purpose);
        if (!parsed.success) {
          return reply
            .status(400)
            .send({ error: 'BadRequest', message: 'Invalid consent purpose' });
        }

        const withdrawn = await withdrawConsent(sub, parsed.data);
        return { withdrawn };
      },
    );
  });
};
