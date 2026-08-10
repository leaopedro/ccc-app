import { prisma } from '@ccc/db';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { serializeBox } from '../services/box/serialize.js';

const BOX_INCLUDE = { items: true, partnerItems: true } as const;
const ELIGIBLE_STATUSES = ['active', 'trialing'] as const;

/** user -> garage -> latest eligible membership. Null when none qualifies. */
export const loadEligibleMembership = async (userId: string): Promise<{ id: string } | null> => {
  const garage = await prisma.garage.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!garage) return null;
  const membership = await prisma.premiumMembership.findFirst({
    where: { garageId: garage.id, status: { in: [...ELIGIBLE_STATUSES] } },
    orderBy: { currentPeriodEnd: 'desc' },
    select: { id: true },
  });
  return membership;
};

export const boxRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/box', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const membership = await loadEligibleMembership(sub);
    if (!membership) {
      return reply.status(403).send({ error: 'box_not_eligible' });
    }
    const box = await prisma.monthlyBox.findFirst({
      where: { membershipId: membership.id },
      orderBy: { cycleStart: 'desc' },
      include: BOX_INCLUDE,
    });
    if (!box) {
      return reply.status(404).send({ error: 'box_not_open' });
    }
    return reply.send(serializeBox(box));
  });
};
