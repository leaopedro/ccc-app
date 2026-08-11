import { prisma } from '@ccc/db';
import {
  pushPrefsSchema,
  pushPrefsStorageSchema,
  updatePushPrefsRequestSchema,
  type PushPrefs,
} from '@ccc/shared';
import { publicProfileSchema, updateProfileSchema } from '@ccc/shared/profile';
import { buildCpfImmutableError, profileStatusSchema } from '@ccc/shared/profile-status';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { recordConsent, withdrawConsent } from '../services/consent.js';
import { decryptField, encryptField } from '../services/crypto/field-encryption.js';
import { loadProfileCompleteness, missingFor } from '../services/profile/completeness.js';
import { queueObjectDeletion } from '../services/uploads/deletion-queue.js';
import type { Uploads } from '../services/uploads/index.js';
import rateLimit from '@fastify/rate-limit';

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
  cpf: string | null;
  phone: string | null;
};

const serializeUser = (user: DbUser, uploads: Uploads, encKey: string) =>
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
    // Decrypted for its owner only. This route is authenticated and scoped to
    // request.user.sub — no other surface returns the plaintext CPF.
    cpf: user.cpf ? decryptField(user.cpf, encKey) : null,
    phone: user.phone,
  });

const normalizePushPrefs = (value: Prisma.JsonValue | null): PushPrefs =>
  pushPrefsSchema.parse(pushPrefsStorageSchema.parse(value ?? {}));

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    return serializeUser(user, app.uploads, app.env.FIELD_ENCRYPTION_KEY);
  });

  app.patch('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const existing = await prisma.user.findUnique({
      where: { id: sub },
      select: { avatarObjectKey: true, cpf: true },
    });
    if (!existing) return reply.status(401).send({ error: 'Unauthorized' });
    // Strip undefined values: Prisma's exactOptionalPropertyTypes rejects `string | undefined`
    // where its generated types expect `string | StringFieldUpdateOperationsInput`.
    const data = Object.fromEntries(
      Object.entries(updateProfileSchema.parse(request.body)).filter(([, v]) => v !== undefined),
    );
    // CPF is a fiscal identifier tied to orders already issued and it is
    // encrypted at rest, so once a member has one on file it is immutable.
    // Resubmitting the same value (e.g. an edit form round-tripping it) is a
    // no-op, not an error. Compare after Zod normalization so a masked and
    // a bare value compare equal.
    if (typeof data.cpf === 'string') {
      if (existing.cpf) {
        // decryptField swallows decryption errors (e.g. a rotated
        // FIELD_ENCRYPTION_KEY) and returns null instead of throwing, but we
        // wrap it anyway in case that contract ever changes. Either way, if
        // we can't recover the stored value we can't prove the incoming one
        // matches it. Refuse the change rather than risk silently
        // overwriting an unrecoverable fiscal identifier.
        let storedCpf: string | null;
        try {
          storedCpf = decryptField(existing.cpf, app.env.FIELD_ENCRYPTION_KEY);
        } catch (err) {
          app.log.warn({ err, userId: sub }, 'failed to decrypt stored cpf during PATCH /me');
          storedCpf = null;
        }
        if (storedCpf === null) {
          app.log.warn({ userId: sub }, 'could not verify stored cpf during PATCH /me');
          return reply.status(409).send(buildCpfImmutableError());
        }
        if (storedCpf === data.cpf) {
          delete data.cpf;
        } else {
          return reply.status(409).send(buildCpfImmutableError());
        }
      } else {
        data.cpf = encryptField(data.cpf, app.env.FIELD_ENCRYPTION_KEY);
      }
    }
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
    return serializeUser(user, app.uploads, app.env.FIELD_ENCRYPTION_KEY);
  });

  app.get('/me/profile-status', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);

    const completeness = await loadProfileCompleteness(sub);
    if (!completeness) return reply.status(401).send({ error: 'Unauthorized' });

    const latest = await prisma.userDocument.findFirst({
      where: { userId: sub },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        status: true,
        sentAt: true,
        reviewedAt: true,
        rejectionReason: true,
      },
    });

    const checkoutMissing = missingFor(completeness, 'checkout');
    const subscriptionMissing = missingFor(completeness, 'subscription');

    return profileStatusSchema.parse({
      fields: completeness,
      checkout: { complete: checkoutMissing.length === 0, missing: checkoutMissing },
      subscription: { complete: subscriptionMissing.length === 0, missing: subscriptionMissing },
      latestDocument: latest
        ? {
            id: latest.id,
            type: latest.type,
            status: latest.status,
            sentAt: latest.sentAt.toISOString(),
            reviewedAt: latest.reviewedAt ? latest.reviewedAt.toISOString() : null,
            rejectionReason: latest.rejectionReason,
          }
        : null,
    });
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
