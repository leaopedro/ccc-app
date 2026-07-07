import { prisma } from '@jdm/db';
import {
  mfaDisableSchema,
  mfaSetupResponseSchema,
  mfaStatusSchema,
  mfaVerifySetupSchema,
} from '@jdm/shared/mfa';
import type { FastifyPluginAsync } from 'fastify';

import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyRecoveryCode,
  verifyTotp,
} from '../../services/auth/mfa.js';

const requireMfaKey = (env: Record<string, unknown>): string => {
  const key = (env as { MFA_ENCRYPTION_KEY?: string }).MFA_ENCRYPTION_KEY;
  if (!key) throw new Error('MFA_ENCRYPTION_KEY is not configured');
  return key;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminMfaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/mfa/status', async (request, reply) => {
    const userId = request.user!.sub;
    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    const enabled = !!secret?.verifiedAt;
    const remaining = enabled
      ? await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } })
      : undefined;
    return reply.send(mfaStatusSchema.parse({ enabled, recoveryCodes: remaining }));
  });

  app.post('/mfa/setup', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;

    const existing = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (existing?.verifiedAt) {
      return reply
        .status(409)
        .send({ error: 'MfaAlreadyEnrolled', message: 'MFA is already enabled' });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { secret, uri } = generateTotpSecret(user.email);
    const encrypted = encryptSecret(secret, key);
    const codes = generateRecoveryCodes();

    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.mfaSecret.delete({ where: { userId } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      }
      await tx.mfaSecret.create({ data: { userId, encryptedSecret: encrypted } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c, key) })),
      });
      await tx.adminAudit.create({
        data: {
          actorId: userId,
          action: 'mfa.setup_started',
          entityType: 'user',
          entityId: userId,
        },
      });
    });

    return reply.send(mfaSetupResponseSchema.parse({ otpauthUri: uri, recoveryCodes: codes }));
  });

  app.post('/mfa/verify-setup', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;
    const { code } = mfaVerifySetupSchema.parse(request.body);

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret) {
      return reply.status(404).send({ error: 'NoMfaSetup', message: 'run setup first' });
    }
    if (secret.verifiedAt) {
      return reply
        .status(409)
        .send({ error: 'MfaAlreadyEnrolled', message: 'MFA already verified' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    if (!verifyTotp(raw, code)) {
      return reply.status(400).send({ error: 'InvalidCode', message: 'invalid TOTP code' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mfaSecret.update({ where: { userId }, data: { verifiedAt: new Date() } });
      await tx.adminAudit.create({
        data: { actorId: userId, action: 'mfa.enrolled', entityType: 'user', entityId: userId },
      });
    });

    return reply.send({ message: 'MFA enabled' });
  });

  app.delete('/mfa', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;
    const { code } = mfaDisableSchema.parse(request.body);

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret?.verifiedAt) {
      return reply.status(404).send({ error: 'MfaNotEnabled', message: 'MFA is not enabled' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    const isTotp = /^\d{6}$/.test(code);
    let valid = false;

    if (isTotp) {
      valid = verifyTotp(raw, code);
    } else {
      const recoveryCodes = await prisma.mfaRecoveryCode.findMany({
        where: { userId, usedAt: null },
      });
      for (const rc of recoveryCodes) {
        if (verifyRecoveryCode(code, rc.codeHash, key)) {
          await prisma.mfaRecoveryCode.update({
            where: { id: rc.id },
            data: { usedAt: new Date() },
          });
          valid = true;
          break;
        }
      }
    }

    if (!valid) {
      return reply.status(400).send({ error: 'InvalidCode', message: 'invalid code' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaSecret.delete({ where: { userId } });
      await tx.adminAudit.create({
        data: { actorId: userId, action: 'mfa.disabled', entityType: 'user', entityId: userId },
      });
    });

    return reply.send({ message: 'MFA disabled' });
  });

  app.post('/mfa/recovery-codes', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;
    const { code } = mfaVerifySetupSchema.parse(request.body);

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret?.verifiedAt) {
      return reply.status(404).send({ error: 'MfaNotEnabled', message: 'MFA is not enabled' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    if (!verifyTotp(raw, code)) {
      return reply.status(400).send({ error: 'InvalidCode', message: 'invalid TOTP code' });
    }

    const codes = generateRecoveryCodes();
    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c, key) })),
      });
      await tx.adminAudit.create({
        data: {
          actorId: userId,
          action: 'mfa.recovery_codes_regenerated',
          entityType: 'user',
          entityId: userId,
        },
      });
    });

    return reply.send({ recoveryCodes: codes });
  });
};
