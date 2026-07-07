import { randomBytes } from 'node:crypto';

import { prisma } from '@jdm/db';

import { sha256Hex } from './token-hash.js';

const RESET_TTL_MS = 3_600_000;

export const issuePasswordResetToken = async (userId: string): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      },
    }),
  ]);
  return token;
};

// Consume is atomic: claim-by-where-clause prevents double-use under concurrent
// requests. If the subsequent password update fails, the token stays consumed
// and the user must request a new reset — acceptable over a TOCTOU window.
export const consumePasswordResetToken = async (
  token: string,
): Promise<{ userId: string } | null> => {
  const hash = sha256Hex(token);
  const now = new Date();
  const claim = await prisma.passwordResetToken.updateMany({
    where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (claim.count !== 1) return null;
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
  return record ? { userId: record.userId } : null;
};
