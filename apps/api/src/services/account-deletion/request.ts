import { prisma } from '@jdm/db';

export type DeletionRequestResult =
  | { ok: true; status: 'deletion_scheduled' }
  | { ok: false; reason: 'already_deleted' };

export const requestAccountDeletion = async (userId: string): Promise<DeletionRequestResult> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });

  if (!user || user.status === 'deleted' || user.status === 'anonymized') {
    return { ok: false, reason: 'already_deleted' };
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        status: 'deleted',
        deletedAt: now,
        tokenInvalidatedAt: now,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.deletionLog.upsert({
      where: { userId },
      create: { userId, requestedAt: now },
      update: {},
    }),
  ]);

  return { ok: true, status: 'deletion_scheduled' };
};
