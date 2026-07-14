import crypto from 'node:crypto';

import { prisma } from '@ccc/db';
import { adminXpAdjustmentSchema } from '@ccc/shared/admin-garage-xp';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { ensureGarageForUserId } from '../../services/garage/ensure.js';
import { readGamificationEnabled } from '../../services/garage/killswitch.js';
import { awardXp } from '../../services/garage/xp-awarder.js';

/**
 * POST /admin/users/:id/garage/xp-adjustment — admin-only signed XP delta.
 *
 * §C7: body { delta: int [-10000, 10000] non-zero, reason: 3..120 chars }.
 * §C8: `admin_adjustment` is the only awarder reason accepting signed delta.
 * sourceRef format `admin:<adminId>:<uuid>` (canon §7 + §C7) — server-generated
 * per request so repeat support adjustments with the same reason never collide
 * on `@@unique([garageId, reason, sourceRef])` (§C1).
 *
 * Atomicity invariant (review BLOCK): AdminAudit lives INSIDE the same
 * `prisma.$transaction` as awardXp. If the audit insert throws, XpEvent +
 * Garage.xp roll back together — no persisted unaudited admin adjustment.
 *
 * Rate-limit (review MAJOR): own `admin-xp-adj:<sub>` bucket. The outer
 * register block in apps/api/src/routes/admin/index.ts uses the same key
 * prefix so both layers collapse to one logical 30/min/admin bucket; the
 * inner declaration here is defense in depth.
 */
export const adminGarageXpAdjustmentRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-xp-adj:${auth.sub}` : `admin-xp-adj-ip:${req.ip}`;
      },
    });

    scope.post('/users/:id/garage/xp-adjustment', async (request, reply) => {
      const actor = requireUser(request);
      const { id } = request.params as { id: string };

      const parsed = adminXpAdjustmentSchema.safeParse(request.body);
      if (!parsed.success) {
        const zeroIssue = parsed.error.issues.find(
          (i) => i.path[0] === 'delta' && i.message === 'delta cannot be zero',
        );
        if (zeroIssue) return reply.status(400).send({ error: 'invalid_delta' });
        return reply.status(422).send({
          error: 'invalid_body',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { delta, reason } = parsed.data;

      const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!target) return reply.status(404).send({ error: 'NotFound' });

      // Killswitch check BEFORE ensureGarageForUserId. The latter creates a
      // Garage row on first call, so deferring the check to awardXp leaked a
      // write when gamification was disabled. Defense in depth: awardXp also
      // short-circuits internally per fix-canon §5, but the route-level guard
      // means no Garage row is created for a user without one when the switch
      // is off.
      const enabled = await readGamificationEnabled();
      if (!enabled) return reply.status(409).send({ error: 'gamification_disabled' });

      const garage = await ensureGarageForUserId(id);

      // §C7 + §C8: server-generated UUID sourceRef keeps the @@unique([garageId,
      // reason, sourceRef]) constraint deterministic across repeat support calls.
      const sourceRef = `admin:${actor.sub}:${crypto.randomUUID()}`;

      // Atomicity: awardXp + AdminAudit share ONE transaction. If recordAudit
      // throws, XpEvent + Garage.xp updates roll back together. No persisted
      // unaudited admin adjustment. Fix-canon §4 + review BLOCK (chunk 35).
      const outcome = await prisma.$transaction(async (tx) => {
        const result = await awardXp(tx, garage.id, 'admin_adjustment', { delta, sourceRef });
        if (!result.awarded) return { awarded: false as const, reason: result.reason };
        await recordAudit(
          {
            actorId: actor.sub,
            action: 'xp.adjustment',
            entityType: 'garage',
            entityId: garage.id,
            metadata: { delta, reason, sourceRef, targetUserId: id },
          },
          tx,
        );
        const after = await tx.garage.findUniqueOrThrow({
          where: { id: garage.id },
          select: { xp: true },
        });
        return { awarded: true as const, xp: after.xp };
      });

      if (!outcome.awarded) {
        if (outcome.reason === 'gamification_disabled') {
          return reply.status(409).send({ error: 'gamification_disabled' });
        }
        return reply.status(500).send({ error: 'InternalServerError' });
      }

      return reply.status(200).send({ xp: outcome.xp });
    });
  });
};
