import { prisma } from '@ccc/db';
import { boxConfirmSchema, boxSelectionUpdateSchema } from '@ccc/shared/box';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { confirmBox } from '../services/box/confirm.js';
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

    // Find the box id before the transaction (no lock needed for this read).
    const boxRef = await prisma.monthlyBox.findFirst({
      where: { membershipId: membership.id },
      orderBy: { cycleStart: 'desc' },
      select: { id: true },
    });
    if (!boxRef) return reply.status(404).send({ error: 'box_not_open' });

    const input = parsed.data;

    // Sentinel errors thrown inside the transaction to abort it cleanly.
    class BoxLockedError extends Error {
      readonly code = 'box_locked' as const;
      constructor() {
        super('box_locked');
      }
    }
    class MaxExceededError extends Error {
      readonly code = 'max_exceeded' as const;
      constructor(
        readonly catalogItemId: string,
        readonly max: number,
      ) {
        super('max_per_cycle_exceeded');
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Lock the box row first; then re-read status + cutoffAt under the lock.
        await tx.$queryRaw`SELECT id FROM "MonthlyBox" WHERE id = ${boxRef.id} FOR UPDATE`;
        const locked = await tx.monthlyBox.findUnique({
          where: { id: boxRef.id },
          select: { status: true, cutoffAt: true },
        });
        // Box locks at the cutoff instant even if the cron worker has not processed it yet.
        if (!locked || locked.status !== 'open' || locked.cutoffAt <= new Date()) {
          throw new BoxLockedError();
        }

        // Catalog items: diff-merge by catalogItemId, quantity 0 removes.
        for (const line of input.items) {
          if (line.quantity === 0) {
            await tx.monthlyBoxItem.deleteMany({
              where: { boxId: boxRef.id, catalogItemId: line.catalogItemId },
            });
            continue;
          }
          const item = await tx.boxCatalogItem.findUnique({ where: { id: line.catalogItemId } });
          if (!item || !item.active) continue; // ignore unknown/archived items silently
          // Enforce per-cycle quantity cap when set.
          if (item.maxPerCycle != null && line.quantity > item.maxPerCycle) {
            throw new MaxExceededError(line.catalogItemId, item.maxPerCycle);
          }
          const existing = await tx.monthlyBoxItem.findUnique({
            where: { boxId_catalogItemId: { boxId: boxRef.id, catalogItemId: line.catalogItemId } },
          });
          const unitPriceCents = existing?.unitPriceCents ?? item.priceCents;
          const subtotalCents = unitPriceCents * line.quantity;
          await tx.monthlyBoxItem.upsert({
            where: { boxId_catalogItemId: { boxId: boxRef.id, catalogItemId: line.catalogItemId } },
            update: { quantity: line.quantity, subtotalCents },
            create: {
              boxId: boxRef.id,
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
              where: { boxId: boxRef.id, partnerModuleId: line.partnerModuleId },
            });
            continue;
          }
          const mod = await tx.partnerModule.findUnique({ where: { id: line.partnerModuleId } });
          if (!mod || !mod.active) continue;
          const existing = await tx.monthlyBoxPartnerItem.findUnique({
            where: {
              boxId_partnerModuleId: { boxId: boxRef.id, partnerModuleId: line.partnerModuleId },
            },
          });
          const unitPriceCents = existing?.unitPriceCents ?? mod.priceCents;
          const subtotalCents = unitPriceCents * line.quantity;
          await tx.monthlyBoxPartnerItem.upsert({
            where: {
              boxId_partnerModuleId: { boxId: boxRef.id, partnerModuleId: line.partnerModuleId },
            },
            update: { quantity: line.quantity, subtotalCents },
            create: {
              boxId: boxRef.id,
              partnerModuleId: line.partnerModuleId,
              quantity: line.quantity,
              unitPriceCents: mod.priceCents,
              subtotalCents,
              nameSnapshot: mod.name,
              currency: mod.currency,
            },
          });
        }
        await recalcBoxTotals(tx, boxRef.id);
      });
    } catch (err) {
      if (err instanceof BoxLockedError) {
        return reply.status(409).send({ error: 'box_locked' });
      }
      if (err instanceof MaxExceededError) {
        return reply.status(422).send({
          error: 'max_per_cycle_exceeded',
          catalogItemId: err.catalogItemId,
          max: err.max,
        });
      }
      throw err;
    }

    const fresh = await prisma.monthlyBox.findUniqueOrThrow({
      where: { id: boxRef.id },
      include: { items: true, partnerItems: true },
    });
    return reply.send(serializeBox(fresh));
  });

  app.post('/me/box/confirm', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = boxConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });

    const result = await confirmBox({
      userId: sub,
      membershipId: membership.id,
      shippingAddressId: parsed.data.shippingAddressId,
      autoSendOptIn: parsed.data.autoSendOptIn ?? false,
    });
    if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
    if (result.kind === 'not_open') return reply.status(409).send({ error: 'box_locked' });
    if (result.kind === 'bad_address') return reply.status(400).send({ error: 'bad_address' });

    const fresh = await prisma.monthlyBox.findUniqueOrThrow({
      where: { id: result.boxId },
      include: { items: true, partnerItems: true },
    });
    return reply.send(serializeBox(fresh));
  });
};
