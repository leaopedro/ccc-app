import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import { recordAudit } from '../services/admin-audit.js';
import { queueObjectDeletion } from '../services/uploads/deletion-queue.js';
import type { Uploads } from '../services/uploads/index.js';

type PurgeResult = {
  table: string;
  deletedCount: number;
  skippedHolds: number;
  failedCount: number;
};

const MS_PER_DAY = 24 * 3600_000;

export type RetentionWorkerDeps = {
  now?: Date;
  log?: FastifyBaseLogger;
  uploads?: Uploads;
};

async function purgeExpiredRefreshTokens(now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - 7 * MS_PER_DAY);
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return { table: 'RefreshToken', deletedCount: count, skippedHolds: 0, failedCount: 0 };
}

async function purgeConsumedVerificationTokens(now: Date): Promise<PurgeResult> {
  const { count } = await prisma.verificationToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
    },
  });
  return { table: 'VerificationToken', deletedCount: count, skippedHolds: 0, failedCount: 0 };
}

async function purgeConsumedPasswordResetTokens(now: Date): Promise<PurgeResult> {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
    },
  });
  return { table: 'PasswordResetToken', deletedCount: count, skippedHolds: 0, failedCount: 0 };
}

async function purgeOldPaymentWebhookEvents(now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - 90 * MS_PER_DAY);

  const holdCount = await prisma.paymentWebhookEvent.count({
    where: {
      createdAt: { lt: cutoff },
      retentionHoldUntil: { gte: now },
    },
  });

  const { count } = await prisma.paymentWebhookEvent.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [{ retentionHoldUntil: null }, { retentionHoldUntil: { lt: now } }],
    },
  });
  return {
    table: 'PaymentWebhookEvent',
    deletedCount: count,
    skippedHolds: holdCount,
    failedCount: 0,
  };
}

async function purgeOldNotifications(now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - 90 * MS_PER_DAY);
  const { count } = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { table: 'Notification', deletedCount: count, skippedHolds: 0, failedCount: 0 };
}

async function purgeOldBroadcastDeliveries(now: Date): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - 365 * MS_PER_DAY);
  const { count } = await prisma.broadcastDelivery.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { table: 'BroadcastDelivery', deletedCount: count, skippedHolds: 0, failedCount: 0 };
}

async function purgeQueuedUploadDeletions(now: Date, uploads?: Uploads): Promise<PurgeResult> {
  const due = await prisma.uploadDeletionQueue.findMany({
    where: { deleteAfter: { lte: now } },
    orderBy: { deleteAfter: 'asc' },
    take: 500,
  });
  if (!uploads) {
    return {
      table: 'UploadDeletionQueue',
      deletedCount: 0,
      skippedHolds: due.length,
      failedCount: 0,
    };
  }

  let deletedCount = 0;
  let failedCount = 0;
  for (const row of due) {
    try {
      await uploads.deleteObject(row.objectKey);
      await prisma.uploadDeletionQueue.delete({ where: { id: row.id } });
      deletedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return { table: 'UploadDeletionQueue', deletedCount, skippedHolds: 0, failedCount };
}

// Identity-document files are the most sensitive object this system stores.
// The approval decision is what needs to survive, not the image: keep the row
// for audit and purge the object. 90 days after approval leaves room for a
// dispute; 30 after rejection is enough for a resend.
export const DOCUMENT_APPROVED_RETENTION_DAYS = 90;
export const DOCUMENT_REJECTED_RETENTION_DAYS = 30;

// Matches purgeQueuedUploadDeletions's take: 500 neighbour. Caps how many
// rows one tick processes (two writes each); a large first-run backlog just
// catches up over successive nightly ticks instead of blocking the tick.
export const DOCUMENT_PURGE_BATCH = 500;

const daysBefore = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 24 * 3600 * 1000);

/**
 * Queues expired document objects for deletion and stamps `fileDeletedAt`.
 * Idempotent: rows already stamped are skipped, so a re-run queues nothing.
 * Returns how many rows were purged this pass.
 */
export const purgeExpiredDocumentFiles = async (now: Date): Promise<number> => {
  const due = await prisma.userDocument.findMany({
    where: {
      fileDeletedAt: null,
      OR: [
        { status: 'approved', reviewedAt: { lt: daysBefore(now, DOCUMENT_APPROVED_RETENTION_DAYS) } },
        { status: 'rejected', reviewedAt: { lt: daysBefore(now, DOCUMENT_REJECTED_RETENTION_DAYS) } },
      ],
    },
    select: { id: true, objectKey: true },
    take: DOCUMENT_PURGE_BATCH,
  });

  for (const doc of due) {
    // retentionDays: 0 — the 90/30-day windows above ARE the grace period.
    // queueObjectDeletion's own 30-day default exists for the avatar-replaced
    // case, where the user might have made a mistake seconds ago; a document
    // whose retention window already expired needs no second grace. Leaving
    // the default would push the actual R2 deletion to
    // reviewedAt + (90 or 30) + 30 days — 30 days past the window
    // packages/shared/src/legal.ts publishes to data subjects — while
    // fileDeletedAt is stamped immediately below, making GET /me/documents
    // and the admin file endpoint report the file gone for that whole month
    // even though it is still sitting in the bucket. `now` is passed through
    // explicitly so deleteAfter lines up exactly with fileDeletedAt instead
    // of drifting by the few ms between this call and queueObjectDeletion's
    // own `new Date()` default.
    await queueObjectDeletion({
      objectKey: doc.objectKey,
      reason: 'document_retention',
      retentionDays: 0,
      now,
    });
    await prisma.userDocument.update({
      where: { id: doc.id },
      data: { fileDeletedAt: now },
    });
  }

  return due.length;
};

const PURGE_JOBS = [
  purgeExpiredRefreshTokens,
  purgeConsumedVerificationTokens,
  purgeConsumedPasswordResetTokens,
  purgeOldPaymentWebhookEvents,
  purgeOldNotifications,
  purgeOldBroadcastDeliveries,
] as const;

export const runRetentionTick = async (deps: RetentionWorkerDeps): Promise<PurgeResult[]> => {
  const now = deps.now ?? new Date();
  const results: PurgeResult[] = [];

  for (const job of PURGE_JOBS) {
    const result = await job(now);
    results.push(result);

    if (result.deletedCount > 0 || result.skippedHolds > 0 || result.failedCount > 0) {
      deps.log?.info(
        {
          table: result.table,
          deleted: result.deletedCount,
          skippedHolds: result.skippedHolds,
          failed: result.failedCount,
        },
        '[retention] purged',
      );
    }
  }

  const uploadResult = await purgeQueuedUploadDeletions(now, deps.uploads);
  results.push(uploadResult);
  if (
    uploadResult.deletedCount > 0 ||
    uploadResult.skippedHolds > 0 ||
    uploadResult.failedCount > 0
  ) {
    deps.log?.info(
      {
        table: uploadResult.table,
        deleted: uploadResult.deletedCount,
        skippedHolds: uploadResult.skippedHolds,
        failed: uploadResult.failedCount,
      },
      '[retention] purged',
    );
  }

  const documentPurgedCount = await purgeExpiredDocumentFiles(now);
  const documentResult: PurgeResult = {
    table: 'UserDocument',
    deletedCount: documentPurgedCount,
    skippedHolds: 0,
    failedCount: 0,
  };
  results.push(documentResult);
  if (documentPurgedCount > 0) {
    deps.log?.info(
      { table: documentResult.table, deleted: documentResult.deletedCount },
      '[retention] purged',
    );
  }

  await recordAudit({
    actorId: 'system:retention',
    action: 'retention.purge',
    entityType: 'retention_run',
    entityId: now.toISOString().slice(0, 10),
    metadata: Object.fromEntries(
      results.map((r) => [
        r.table,
        { deleted: r.deletedCount, skippedHolds: r.skippedHolds, failed: r.failedCount },
      ]),
    ),
  });

  return results;
};

export const startRetentionWorker = (deps: {
  log: FastifyBaseLogger;
  uploads: Uploads;
}): { stop: () => void } => {
  const task = cron.schedule(
    '0 2 * * *',
    () => {
      void runRetentionTick({ log: deps.log, uploads: deps.uploads }).catch((err: unknown) => {
        deps.log.error({ err }, '[retention] tick failed');
      });
    },
    { timezone: 'America/Sao_Paulo' },
  );
  return {
    stop: () => {
      void task.stop();
    },
  };
};
