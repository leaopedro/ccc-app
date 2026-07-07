import rateLimit from '@fastify/rate-limit';
import { prisma } from '@jdm/db';
import {
  pushPrefsSchema,
  pushPrefsStorageSchema,
  updatePushPrefsRequestSchema,
  type PushPrefs,
} from '@jdm/shared';
import { publicProfileSchema, updateProfileSchema } from '@jdm/shared/profile';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { recordConsent, withdrawConsent } from '../services/consent.js';
import { queueObjectDeletion } from '../services/uploads/deletion-queue.js';
import type { Uploads } from '../services/uploads/index.js';

type DbUser = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'organizer' | 'admin' | 'staff';
  emailVerifiedAt: Date | null;
  createdAt: Date;
  bio: string | null;
  city: string | null;
  stateCode: string | null;
  avatarObjectKey: string | null;
};

const serializeUser = (user: DbUser, uploads: Uploads) =>
  publicProfileSchema.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    bio: user.bio,
    city: user.city,
    stateCode: user.stateCode,
    avatarUrl: user.avatarObjectKey ? uploads.buildPublicUrl(user.avatarObjectKey) : null,
  });

const normalizePushPrefs = (value: Prisma.JsonValue | null): PushPrefs =>
  pushPrefsSchema.parse(pushPrefsStorageSchema.parse(value ?? {}));

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    return serializeUser(user, app.uploads);
  });

  app.patch('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const existing = await prisma.user.findUnique({
      where: { id: sub },
      select: { avatarObjectKey: true },
    });
    if (!existing) return reply.status(401).send({ error: 'Unauthorized' });
    // Strip undefined values: Prisma's exactOptionalPropertyTypes rejects `string | undefined`
    // where its generated types expect `string | StringFieldUpdateOperationsInput`.
    const data = Object.fromEntries(
      Object.entries(updateProfileSchema.parse(request.body)).filter(([, v]) => v !== undefined),
    );
    if (
      typeof data.avatarObjectKey === 'string' &&
      !app.uploads.isOwnedKey(data.avatarObjectKey, sub, 'avatar')
    ) {
      return reply.status(400).send({ error: 'BadRequest', message: 'avatar key not owned' });
    }
    const user = await prisma.user.update({ where: { id: sub }, data });
    if (
      typeof data.avatarObjectKey === 'string' &&
      existing.avatarObjectKey &&
      existing.avatarObjectKey !== data.avatarObjectKey
    ) {
      try {
        await queueObjectDeletion({
          objectKey: existing.avatarObjectKey,
          reason: 'avatar_replaced',
        });
      } catch (err) {
        app.log.warn(
          { err, objectKey: existing.avatarObjectKey, userId: sub },
          'failed to queue old avatar object for deletion',
        );
      }
    }
    return serializeUser(user, app.uploads);
  });

  app.get('/me/push-preferences', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { pushPrefs: true },
    });

    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    return normalizePushPrefs(user.pushPrefs);
  });

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, { max: 10, timeWindow: '1 minute' });

    scoped.patch(
      '/me/push-preferences',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const input = updatePushPrefsRequestSchema.parse(request.body);

        if (input.marketing) {
          await recordConsent({
            userId: sub,
            purpose: 'push_marketing',
            version: 'v1',
            channel: 'mobile',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] ?? null,
            evidence: { source: 'push_preferences_toggle' },
          });
        } else {
          await withdrawConsent(sub, 'push_marketing');
        }

        const user = await prisma.user.findUnique({
          where: { id: sub },
          select: { pushPrefs: true },
        });

        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        return normalizePushPrefs(user.pushPrefs);
      },
    );
  });
};
