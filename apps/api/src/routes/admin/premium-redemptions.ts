/**
 * admin premium-redemptions route — staff/organizer/admin redeem an add-on's
 * per-cycle quota on behalf of a member (e.g. at the door / front desk).
 *
 *   POST /admin/premium/addons/:membershipAddonId/redeem
 *
 * Registered under the requireRole('organizer','admin','staff') scope in
 * admin/index.ts (same scope as check-in). No env flag gate — redemption is an
 * operational action, not a billing action.
 */

import { prisma } from '@jdm/db';
import {
  redeemAddonRequestSchema,
  redeemAddonResponseSchema,
} from '@jdm/shared/premium-subscription';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminPremiumRedemptionRoutes: FastifyPluginAsync = async (app) => {
  app.post('/premium/addons/:membershipAddonId/redeem', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const { membershipAddonId } = request.params as { membershipAddonId: string };

    const parsed = redeemAddonRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const { amount, note } = parsed.data;

    const addon = await prisma.premiumMembershipAddon.findUnique({
      where: { id: membershipAddonId },
      select: { id: true },
    });
    if (!addon) {
      return reply.status(404).send({ error: 'NotFound', message: 'membership add-on not found' });
    }

    // Current open cycle — cycleEnd in the future, most recent by cycleStart.
    const usage = await prisma.premiumAddonUsage.findFirst({
      where: { membershipAddonId: addon.id, cycleEnd: { gte: new Date() } },
      orderBy: { cycleStart: 'desc' },
      select: { id: true, quotaTotal: true },
    });
    if (!usage) {
      return reply.status(404).send({ error: 'NotFound', message: 'no open usage cycle' });
    }

    // Atomic guard against concurrent redeems: the over-quota check and the
    // increment happen in one conditional updateMany. quotaTotal is fixed per
    // cycle, so `threshold` is stable; the race is only on quotaUsed, and
    // `quotaUsed <= threshold` is evaluated at write time under the row lock.
    // count === 0 means another redeem already consumed the remaining quota.
    const threshold = usage.quotaTotal - amount;

    const updated = await prisma.$transaction(async (tx) => {
      const guarded = await tx.premiumAddonUsage.updateMany({
        where: { id: usage.id, quotaUsed: { lte: threshold } },
        data: { quotaUsed: { increment: amount } },
      });
      if (guarded.count === 0) return null;
      await tx.premiumAddonRedemption.create({
        data: {
          usageId: usage.id,
          amount,
          redeemedByUserId: actorId,
          note: note ?? null,
        },
      });
      return tx.premiumAddonUsage.findUnique({
        where: { id: usage.id },
        select: { quotaTotal: true, quotaUsed: true },
      });
    });

    if (!updated) {
      const current = await prisma.premiumAddonUsage.findUnique({
        where: { id: usage.id },
        select: { quotaTotal: true, quotaUsed: true },
      });
      return reply.status(409).send({
        error: 'QuotaExceeded',
        message: 'redemption exceeds remaining quota',
        quotaRemaining: current ? current.quotaTotal - current.quotaUsed : 0,
      });
    }

    return reply.status(200).send(
      redeemAddonResponseSchema.parse({
        membershipAddonId: addon.id,
        quotaTotal: updated.quotaTotal,
        quotaUsed: updated.quotaUsed,
        quotaRemaining: updated.quotaTotal - updated.quotaUsed,
      }),
    );
  });
};
