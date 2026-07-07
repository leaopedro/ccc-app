import rateLimit from '@fastify/rate-limit';
import { prisma } from '@jdm/db';
import {
  createSupportTicketBodySchema,
  supportTicketSchema,
  type SupportTicket,
} from '@jdm/shared/support';
import type { SupportTicket as DbTicket } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { decryptField, encryptField } from '../services/crypto/field-encryption.js';
import type { Uploads } from '../services/uploads/index.js';

const serializeTicket = async (
  t: DbTicket,
  uploads: Uploads,
  encKey: string,
): Promise<SupportTicket> =>
  supportTicketSchema.parse({
    id: t.id,
    phone: t.phone,
    message: decryptField(t.message, encKey) ?? t.message,
    attachmentUrl: t.attachmentObjectKey
      ? await uploads.buildSignedGetUrl(t.attachmentObjectKey)
      : null,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  });

export const meSupportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/support-tickets', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: sub, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: await Promise.all(
        tickets.map((t) => serializeTicket(t, app.uploads, app.env.FIELD_ENCRYPTION_KEY)),
      ),
    };
  });

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '15 minutes',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `support-create:${auth.sub}` : `support-create-ip:${req.ip}`;
      },
    });

    scoped.post(
      '/me/support-tickets',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const { phone, message, attachmentObjectKey } = createSupportTicketBodySchema.parse(
          request.body,
        );

        if (attachmentObjectKey !== undefined) {
          if (!app.uploads.isOwnedKey(attachmentObjectKey, sub, 'support_attachment')) {
            return reply.status(400).send({ error: 'BadRequest', message: 'invalid attachment' });
          }
        }

        const ticket = await prisma.supportTicket.create({
          data: {
            userId: sub,
            phone,
            message: encryptField(message, app.env.FIELD_ENCRYPTION_KEY),
            attachmentObjectKey: attachmentObjectKey ?? null,
            status: 'open',
          },
        });

        return reply
          .status(201)
          .send(await serializeTicket(ticket, app.uploads, app.env.FIELD_ENCRYPTION_KEY));
      },
    );
  });
};
