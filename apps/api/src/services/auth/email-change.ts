import { randomBytes } from 'node:crypto';

import { prisma } from '@jdm/db';
import { Prisma } from '@prisma/client';

import { sha256Hex } from './token-hash.js';

const CHANGE_TTL_MS = 24 * 3_600_000;

export const issueEmailChangeToken = async (
  userId: string,
  pendingEmail: string,
): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await prisma.$transaction([
    prisma.emailChangeToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.emailChangeToken.create({
      data: {
        userId,
        pendingEmail,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + CHANGE_TTL_MS),
      },
    }),
  ]);
  return token;
};

export type ConsumeEmailChangeResult =
  | { ok: true; userId: string; oldEmail: string; newEmail: string }
  | { ok: false };

export const consumeEmailChangeToken = async (token: string): Promise<ConsumeEmailChangeResult> => {
  const hash = sha256Hex(token);
  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const claim = await tx.emailChangeToken.updateMany({
        where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claim.count !== 1) return { ok: false };

      const record = await tx.emailChangeToken.findUnique({ where: { tokenHash: hash } });
      if (!record) return { ok: false };

      const user = await tx.user.findUnique({ where: { id: record.userId } });
      if (!user) return { ok: false };

      const conflict = await tx.user.findUnique({ where: { email: record.pendingEmail } });
      if (conflict) return { ok: false };

      await tx.user.update({
        where: { id: record.userId },
        data: { email: record.pendingEmail, emailVerifiedAt: now, tokenInvalidatedAt: now },
      });

      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      return {
        ok: true,
        userId: record.userId,
        oldEmail: user.email,
        newEmail: record.pendingEmail,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false };
    }
    throw err;
  }
};
