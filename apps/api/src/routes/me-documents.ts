import { prisma } from '@ccc/db';
import {
  createDocumentBodySchema,
  documentUploadRequestSchema,
  documentUploadResponseSchema,
  DOCUMENT_ALREADY_PENDING_CODE,
  LIVE_DOCUMENT_STATUSES,
  userDocumentListResponseSchema,
  userDocumentSchema,
  type UserDocument as SharedUserDocument,
} from '@ccc/shared/documents';
import rateLimit from '@fastify/rate-limit';
import type { UserDocument as DbUserDocument } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import type { Uploads } from '../services/uploads/index.js';

const serializeDocument = async (
  doc: DbUserDocument,
  uploads: Uploads,
  ttlSeconds: number,
): Promise<SharedUserDocument> =>
  userDocumentSchema.parse({
    id: doc.id,
    type: doc.type,
    status: doc.status,
    sentAt: doc.sentAt.toISOString(),
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
    rejectionReason: doc.rejectionReason,
    // Signed GET only, short TTL. buildPublicUrl would hand out a URL in the
    // public bucket's namespace, which is exactly what this feature avoids.
    fileUrl: doc.fileDeletedAt ? null : await uploads.buildSignedGetUrl(doc.objectKey, ttlSeconds),
  });

export const meDocumentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/documents', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const docs = await prisma.userDocument.findMany({
      where: { userId: sub },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    });
    return userDocumentListResponseSchema.parse({
      items: await Promise.all(
        docs.map((d) => serializeDocument(d, app.uploads, app.env.DOCUMENT_URL_TTL_SECONDS)),
      ),
    });
  });

  // hook: 'preHandler' is required because the keyGenerator reads
  // request.user, which only exists after app.authenticate runs. Without it
  // the rate-limit plugin keys on the earlier onRequest hook and falls back
  // to req.ip, rate-limiting every user behind one NAT as a single caller.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '15 minutes',
      hook: 'preHandler',
      keyGenerator: (req) => `documents:${req.user?.sub ?? req.ip}`,
    });

    scoped.post('/me/documents/upload', async (request, reply) => {
      const { sub } = requireUser(request);
      const input = documentUploadRequestSchema.parse(request.body);

      const presigned = await app.uploads.presignPut({
        // Server-injected: the client cannot repoint this presign at another
        // upload category. Same guard as POST /me/garage/cover/upload.
        kind: 'identity_document',
        userId: sub,
        contentType: input.contentType,
        size: input.size,
      });

      return reply.status(201).send(
        documentUploadResponseSchema.parse({
          uploadUrl: presigned.uploadUrl,
          objectKey: presigned.objectKey,
          expiresAt: presigned.expiresAt.toISOString(),
          headers: presigned.headers,
        }),
      );
    });

    scoped.post('/me/documents', async (request, reply) => {
      const { sub } = requireUser(request);
      const input = createDocumentBodySchema.parse(request.body);

      if (!app.uploads.isOwnedKey(input.objectKey, sub, 'identity_document')) {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid document key' });
      }

      // Without this, a member can satisfy the subscription's "we hold a
      // document to review" gate by naming a key that was never actually
      // uploaded: the row is born pending, review has nothing to review.
      if (!(await app.uploads.objectExists(input.objectKey))) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'upload não foi concluído',
        });
      }

      const live = await prisma.userDocument.findFirst({
        where: { userId: sub, status: { in: [...LIVE_DOCUMENT_STATUSES] } },
        select: { id: true },
      });
      if (live) {
        return reply.status(409).send({
          error: 'Conflict',
          code: DOCUMENT_ALREADY_PENDING_CODE,
          message: 'Você já tem um documento em análise.',
        });
      }

      const doc = await prisma.userDocument.create({
        data: { userId: sub, type: input.type, objectKey: input.objectKey },
      });

      return reply
        .status(201)
        .send(await serializeDocument(doc, app.uploads, app.env.DOCUMENT_URL_TTL_SECONDS));
    });
  });
};
