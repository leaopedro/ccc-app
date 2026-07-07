import { randomBytes } from 'node:crypto';

import { prisma } from '@jdm/db';

import { sha256Hex } from './token-hash.js';

const VERIFY_TTL_MS = 24 * 3_600_000;

export const issueVerificationToken = async (userId: string): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await prisma.$transaction([
    prisma.verificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.verificationToken.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + VERIFY_TTL_MS),
      },
    }),
  ]);
  return token;
};

export const consumeVerificationToken = async (
  token: string,
): Promise<{ userId: string } | null> => {
  const hash = sha256Hex(token);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claim = await tx.verificationToken.updateMany({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claim.count !== 1) return null;
    const record = await tx.verificationToken.findUnique({ where: { tokenHash: hash } });
    if (!record) return null;
    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });
    return { userId: record.userId };
  });
};
