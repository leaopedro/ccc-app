import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import { recordAudit } from '../services/admin-audit.js';
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

async function scrubOldConsentIpMetadata(now: Date): Promise<PurgeResult> {
  // The consent record itself is retained as proof, but the IP/user-agent
  // captured with it are access-log metadata. The privacy policy states access
  // logs (IP, user-agent) are kept 90 days, so null them out past that window.
  const cutoff = new Date(now.getTime() - 90 * MS_PER_DAY);
  const { count } = await prisma.consent.updateMany({
    where: {
      givenAt: { lt: cutoff },
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
    },
    data: { ipAddress: null, userAgent: null },
  });
  return { table: 'Consent', deletedCount: count, skippedHolds: 0, failedCount: 0 };
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

const PURGE_JOBS = [
  purgeExpiredRefreshTokens,
  purgeConsumedVerificationTokens,
  purgeConsumedPasswordResetTokens,
  purgeOldPaymentWebhookEvents,
  scrubOldConsentIpMetadata,
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
