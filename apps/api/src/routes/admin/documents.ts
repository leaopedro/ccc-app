import { prisma } from '@ccc/db';
import type { AdminAuditAction } from '@ccc/shared/admin';
import { USER_DOCUMENT_STATUSES } from '@ccc/shared/documents';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

const listQuerySchema = z.object({
  status: z.enum(USER_DOCUMENT_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

const encodeCursor = (row: { sentAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ s: row.sentAt.toISOString(), i: row.id })).toString('base64url');

const decodeCursor = (raw: string): { sentAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { s: string; i: string };
  return { sentAt: new Date(parsed.s), id: parsed.i };
};

// The review queue. Deliberately returns NO file url: reading the document is
// a separate, audited request. Listing the queue is not the same act as
// looking at someone's ID.
export const adminDocumentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents', async (request, reply) => {
    const { status, cursor, limit } = listQuerySchema.parse(request.query);

    let decodedCursor: { sentAt: Date; id: string } | null = null;
    if (cursor) {
      try {
        decodedCursor = decodeCursor(cursor);
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const where = status ? { status } : {};
    const rows = await prisma.userDocument.findMany({
      where: decodedCursor
        ? {
            ...where,
            OR: [
              { sentAt: { lt: decodedCursor.sentAt } },
              { sentAt: decodedCursor.sentAt, id: { lt: decodedCursor.id } },
            ],
          }
        : where,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        rejectionReason: true,
        reviewedAt: true,
        reviewedByAdminId: true,
        fileDeletedAt: true,
        sentAt: true,
        user: { select: { name: true, email: true } },
      },
    });

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? encodeCursor(page[page.length - 1]!) : null;

    return reply.status(200).send({
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: row.user.name,
        userEmail: row.user.email,
        type: row.type,
        status: row.status,
        rejectionReason: row.rejectionReason,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        reviewedByAdminId: row.reviewedByAdminId,
        filePurged: row.fileDeletedAt !== null,
        sentAt: row.sentAt.toISOString(),
      })),
      nextCursor: next,
    });
  });

  app.get<{ Params: { id: string } }>('/documents/:id/file', async (request, reply) => {
    const { sub } = requireUser(request);
    const doc = await prisma.userDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true, objectKey: true, fileDeletedAt: true },
    });
    if (!doc) return reply.status(404).send({ error: 'NotFound', message: 'document not found' });
    if (doc.fileDeletedAt) {
      return reply.status(410).send({ error: 'Gone', message: 'document file was purged' });
    }

    // Audit BEFORE handing out the URL. If the audit write fails, the reviewer
    // does not get the link — an unlogged look at an ID is the failure mode
    // this ordering prevents.
    await recordAudit({
      actorId: sub,
      action: 'document_viewed',
      entityType: 'user_document',
      entityId: doc.id,
    });

    const url = await app.uploads.buildSignedGetUrl(
      doc.objectKey,
      app.env.DOCUMENT_URL_TTL_SECONDS,
    );
    return reply.redirect(url, 302);
  });

  // The status write and its audit row share ONE transaction. A committed
  // rejection with a failed audit insert would leave a member permanently
  // rejected with no durable record of who decided it or why — the
  // rejectionReason column is that record's only home. Same precedent as
  // apps/api/src/routes/admin/garage-xp-adjustment.ts:79-94 (fix-canon §4 +
  // review BLOCK chunk 35): no persisted unaudited admin action. The guarded
  // updateMany stays inside the transaction, so the two-reviewer race still
  // yields one winner and one 409 — returning 0 before the audit write means
  // no audit row is written for a transition that did not happen.
  const review = async (
    id: string,
    actorId: string,
    next: 'approved' | 'rejected',
    reason: string | null,
    action: AdminAuditAction,
  ): Promise<number> =>
    prisma.$transaction(async (tx) => {
      const guarded = await tx.userDocument.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: next,
          rejectionReason: reason,
          reviewedByAdminId: actorId,
          reviewedAt: new Date(),
        },
      });
      if (guarded.count === 0) return 0;

      await recordAudit(
        {
          actorId,
          action,
          entityType: 'user_document',
          entityId: id,
          ...(reason ? { metadata: { reason } } : {}),
        },
        tx,
      );
      return guarded.count;
    });

  app.post<{ Params: { id: string } }>('/documents/:id/approve', async (request, reply) => {
    const { sub } = requireUser(request);
    const exists = await prisma.userDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!exists)
      return reply.status(404).send({ error: 'NotFound', message: 'document not found' });

    const count = await review(request.params.id, sub, 'approved', null, 'document_approved');
    if (count === 0) {
      return reply
        .status(409)
        .send({ error: 'Conflict', message: 'document was already reviewed' });
    }

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: request.params.id } });
    return reply.status(200).send({
      id: row.id,
      status: row.status,
      reviewedAt: row.reviewedAt!.toISOString(),
    });
  });

  // Rejection records the decision and nothing else. It does NOT suspend an
  // existing membership: subscription state only ever changes through a
  // verified provider webhook. Suspending is a separate, explicit admin act
  // through the Stripe cancel path.
  app.post<{ Params: { id: string } }>('/documents/:id/reject', async (request, reply) => {
    const { sub } = requireUser(request);
    const { reason } = rejectBodySchema.parse(request.body);

    const exists = await prisma.userDocument.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!exists)
      return reply.status(404).send({ error: 'NotFound', message: 'document not found' });

    const count = await review(request.params.id, sub, 'rejected', reason, 'document_rejected');
    if (count === 0) {
      return reply
        .status(409)
        .send({ error: 'Conflict', message: 'document was already reviewed' });
    }

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: request.params.id } });
    return reply.status(200).send({
      id: row.id,
      status: row.status,
      reviewedAt: row.reviewedAt!.toISOString(),
      rejectionReason: row.rejectionReason,
    });
  });
};
