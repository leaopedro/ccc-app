import { prisma } from '@ccc/db';
import { boxSelectionUpdateSchema } from '@ccc/shared/box';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { recalcBoxTotals } from '../services/box/recalc.js';
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

  app.put('/me/box/selection', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = boxSelectionUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });

    const box = await prisma.monthlyBox.findFirst({
      where: { membershipId: membership.id },
      orderBy: { cycleStart: 'desc' },
      select: { id: true, status: true },
    });
    if (!box) return reply.status(404).send({ error: 'box_not_open' });
    if (box.status !== 'open') return reply.status(409).send({ error: 'box_locked' });

    const input = parsed.data;

    await prisma.$transaction(async (tx) => {
      // Catalog items: diff-merge by catalogItemId, quantity 0 removes.
      for (const line of input.items) {
        if (line.quantity === 0) {
          await tx.monthlyBoxItem.deleteMany({
            where: { boxId: box.id, catalogItemId: line.catalogItemId },
          });
          continue;
        }
        const item = await tx.boxCatalogItem.findUnique({ where: { id: line.catalogItemId } });
        if (!item || !item.active) continue; // ignore unknown/archived items silently
        const existing = await tx.monthlyBoxItem.findUnique({
          where: { boxId_catalogItemId: { boxId: box.id, catalogItemId: line.catalogItemId } },
        });
        const unitPriceCents = existing?.unitPriceCents ?? item.priceCents;
        const subtotalCents = unitPriceCents * line.quantity;
        await tx.monthlyBoxItem.upsert({
          where: { boxId_catalogItemId: { boxId: box.id, catalogItemId: line.catalogItemId } },
          update: { quantity: line.quantity, subtotalCents },
          create: {
            boxId: box.id,
            catalogItemId: line.catalogItemId,
            quantity: line.quantity,
            unitPriceCents: item.priceCents,
            subtotalCents,
            titleSnapshot: item.title,
            currency: item.currency,
          },
        });
      }
      // Partner modules: same diff-merge by partnerModuleId.
      for (const line of input.partnerItems) {
        if (line.quantity === 0) {
          await tx.monthlyBoxPartnerItem.deleteMany({
            where: { boxId: box.id, partnerModuleId: line.partnerModuleId },
          });
          continue;
        }
        const mod = await tx.partnerModule.findUnique({ where: { id: line.partnerModuleId } });
        if (!mod || !mod.active) continue;
        const existing = await tx.monthlyBoxPartnerItem.findUnique({
          where: {
            boxId_partnerModuleId: { boxId: box.id, partnerModuleId: line.partnerModuleId },
          },
        });
        const unitPriceCents = existing?.unitPriceCents ?? mod.priceCents;
        const subtotalCents = unitPriceCents * line.quantity;
        await tx.monthlyBoxPartnerItem.upsert({
          where: {
            boxId_partnerModuleId: { boxId: box.id, partnerModuleId: line.partnerModuleId },
          },
          update: { quantity: line.quantity, subtotalCents },
          create: {
            boxId: box.id,
            partnerModuleId: line.partnerModuleId,
            quantity: line.quantity,
            unitPriceCents: mod.priceCents,
            subtotalCents,
            nameSnapshot: mod.name,
            currency: mod.currency,
          },
        });
      }
      await recalcBoxTotals(tx, box.id);
    });

    const fresh = await prisma.monthlyBox.findUniqueOrThrow({
      where: { id: box.id },
      include: { items: true, partnerItems: true },
    });
    return reply.send(serializeBox(fresh));
  });
};
