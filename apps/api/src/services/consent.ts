import { prisma } from '@jdm/db';
import { Prisma } from '@prisma/client';
import type { ConsentChannel, ConsentPurpose } from '@prisma/client';

type RecordConsentParams = {
  userId: string;
  purpose: ConsentPurpose;
  version: string;
  channel: ConsentChannel;
  ipAddress: string | null;
  userAgent: string | null;
  evidence: Prisma.InputJsonValue;
};

const syncPushMarketingPref = async (userId: string, enabled: boolean) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pushPrefs: true },
  });
  if (!user) return;
  const current = (user.pushPrefs as Record<string, unknown>) ?? {};
  await prisma.user.update({
    where: { id: userId },
    data: {
      pushPrefs: { ...current, marketing: enabled } as Prisma.InputJsonValue,
    },
  });
};

export const recordConsent = async (params: RecordConsentParams) => {
  const { userId, purpose, version, channel, ipAddress, userAgent, evidence } = params;

  const existing = await prisma.consent.findFirst({
    where: { userId, purpose, version, withdrawnAt: null },
  });
  if (existing) return existing;

  try {
    const row = await prisma.consent.create({
      data: { userId, purpose, version, channel, ipAddress, userAgent, evidence },
    });

    if (purpose === 'push_marketing') {
      await syncPushMarketingPref(userId, true);
    }

    return row;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const winner = await prisma.consent.findFirstOrThrow({
        where: { userId, purpose, version, withdrawnAt: null },
      });
      return winner;
    }
    throw e;
  }
};

export const withdrawConsent = async (
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> => {
  const result = await prisma.consent.updateMany({
    where: { userId, purpose, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });

  if (result.count === 0) return false;

  if (purpose === 'push_marketing') {
    await syncPushMarketingPref(userId, false);
  }

  return true;
};

export const hasActiveConsent = async (
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> => {
  const count = await prisma.consent.count({
    where: { userId, purpose, withdrawnAt: null },
  });
  return count > 0;
};

export const listUserConsents = async (userId: string) => {
  return prisma.consent.findMany({
    where: { userId },
    orderBy: { givenAt: 'desc' },
    select: {
      id: true,
      purpose: true,
      version: true,
      givenAt: true,
      withdrawnAt: true,
      channel: true,
    },
  });
};
