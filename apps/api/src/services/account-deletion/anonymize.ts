import { randomBytes } from 'node:crypto';

import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';

import { findFreeGarageSlug } from '../garage/index.js';
import { queueObjectDeletion } from '../uploads/deletion-queue.js';
import type { Uploads } from '../uploads/index.js';

export type StepEntry = {
  step: string;
  status: 'ok' | 'skipped' | 'error';
  error?: string;
  at: string;
};

export type AnonymizeResult = { ok: true; skipped?: boolean } | { ok: false; error: string };

export const anonymizeUser = async (
  userId: string,
  uploads: Uploads,
  priorSteps: StepEntry[] = [],
): Promise<AnonymizeResult> => {
  void uploads;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, avatarObjectKey: true },
  });

  if (!user) return { ok: false, error: 'user_not_found' };
  if (user.status === 'anonymized') return { ok: true, skipped: true };
  if (user.status !== 'deleted') return { ok: false, error: 'user_not_deleted' };

  const steps: StepEntry[] = [...priorSteps];
  const now = new Date();

  // Collect R2 keys to delete
  const objectKeys: string[] = [];
  if (user.avatarObjectKey) objectKeys.push(user.avatarObjectKey);

  const carPhotos = await prisma.carPhoto.findMany({
    where: { car: { userId } },
    select: { objectKey: true },
  });
  objectKeys.push(...carPhotos.map((p) => p.objectKey));

  const feedPhotos = await prisma.feedPostPhoto.findMany({
    where: { post: { authorUserId: userId } },
    select: { objectKey: true },
  });
  objectKeys.push(...feedPhotos.map((p) => p.objectKey));

  const supportAttachments = await prisma.supportTicket.findMany({
    where: { userId, attachmentObjectKey: { not: null } },
    select: { attachmentObjectKey: true },
  });
  objectKeys.push(
    ...supportAttachments.map((s) => s.attachmentObjectKey).filter((k): k is string => k !== null),
  );

  // Queue R2 objects for retention-window sweep (best-effort, log failures)
  for (const key of objectKeys) {
    try {
      await queueObjectDeletion({
        objectKey: key,
        reason: 'account_anonymized',
      });
      steps.push({ step: `r2_queue_delete:${key}`, status: 'ok', at: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({
        step: `r2_queue_delete:${key}`,
        status: 'error',
        error: msg,
        at: new Date().toISOString(),
      });
    }
  }

  // Delete user-owned data (cars cascade to car_photos; feed posts cascade to photos)
  await prisma.car.deleteMany({ where: { userId } });
  steps.push({ step: 'delete_cars', status: 'ok', at: new Date().toISOString() });

  await prisma.deviceToken.deleteMany({ where: { userId } });
  steps.push({ step: 'delete_device_tokens', status: 'ok', at: new Date().toISOString() });

  await prisma.supportTicket.deleteMany({ where: { userId } });
  steps.push({ step: 'delete_support_tickets', status: 'ok', at: new Date().toISOString() });

  // Nullify feed authorship (preserve content, remove identity link)
  await prisma.feedPost.updateMany({
    where: { authorUserId: userId },
    data: { authorUserId: null },
  });
  await prisma.feedComment.updateMany({
    where: { authorUserId: userId },
    data: { authorUserId: null },
  });
  steps.push({ step: 'nullify_feed_authorship', status: 'ok', at: new Date().toISOString() });

  // Delete auth artifacts
  await prisma.authProvider.deleteMany({ where: { userId } });
  await prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
  await prisma.mfaSecret.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.verificationToken.deleteMany({ where: { userId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.emailChangeToken.deleteMany({ where: { userId } });
  steps.push({ step: 'delete_auth_artifacts', status: 'ok', at: new Date().toISOString() });

  // Anonymize user row (keep row alive for fiscal FK on orders) + scrub
  // Garage row in the same tx. Garage stays alive (FK cascades from User)
  // but carries no personal content. Slug rewrite frees the original vanity
  // slug for re-use. See spec §4.3 + §6.3.
  const anonEmail = `deleted_${randomBytes(8).toString('hex')}@removed.local`;
  const deletedSlugBase = `deleted-${userId.slice(0, 8).toLowerCase()}`;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonEmail,
        name: 'Deleted User',
        passwordHash: null,
        bio: null,
        city: null,
        stateCode: null,
        avatarObjectKey: null,
        status: 'anonymized',
        anonymizedAt: now,
        pushPrefs: { transactional: false, marketing: false } as unknown as Prisma.InputJsonValue,
      },
    });

    const existingGarage = await tx.garage.findUnique({ where: { userId } });
    if (existingGarage) {
      // Conquistas (chunk 18, §C17): wipe earned-badge rows for this
      // user inside the SAME anonymize tx as the garage scrub. We do
      // this BEFORE the garage update so the row count is observable on
      // the original garageId for diagnostics. Killswitch does NOT gate
      // this — anonymization MUST clean up regardless of whether the
      // gamification feature is currently disabled.
      await tx.garageBadge.deleteMany({
        where: { garageId: existingGarage.id },
      });

      // Canon §14 (chunk 28): XP surface cleanup. Delete XpEvent rows
      // BEFORE resetting the counters so the deletion is observable
      // against the original garageId. Killswitch-INDEPENDENT —
      // anonymization MUST clean up regardless of whether gamification
      // is currently disabled.
      await tx.xpEvent.deleteMany({ where: { garageId: existingGarage.id } });

      const freeSlug = await findFreeGarageSlug(tx, deletedSlugBase);
      await tx.garage.update({
        where: { userId },
        data: {
          name: 'Garagem',
          slug: freeSlug,
          description: null,
          isPublic: false,
          premiumTier: null,
          premiumUntil: null,
          xp: 0,
          likesReceived: 0,
        },
      });
    }
  });
  steps.push({ step: 'anonymize_user_row', status: 'ok', at: new Date().toISOString() });
  steps.push({ step: 'anonymize_garage', status: 'ok', at: new Date().toISOString() });
  steps.push({ step: 'delete_garage_badges', status: 'ok', at: new Date().toISOString() });
  steps.push({ step: 'delete_xp_events', status: 'ok', at: new Date().toISOString() });
  steps.push({ step: 'reset_xp_counters', status: 'ok', at: new Date().toISOString() });

  // Mark DeletionLog complete (upsert in case row is missing for pre-existing deletions)
  await prisma.deletionLog.upsert({
    where: { userId },
    update: {
      completedAt: now,
      steps: steps as unknown as Prisma.InputJsonValue,
    },
    create: {
      userId,
      requestedAt: now,
      completedAt: now,
      steps: steps as unknown as Prisma.InputJsonValue,
    },
  });

  return { ok: true };
};
