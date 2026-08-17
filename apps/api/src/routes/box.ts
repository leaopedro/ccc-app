import { prisma } from '@ccc/db';
import {
  boxConfirmSchema,
  boxPreferencesSchema,
  boxSelectionUpdateSchema,
  meetsMinTier,
} from '@ccc/shared/box';
import type { GaragePremiumTier } from '@ccc/shared/garage';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { buildBoxCatalog } from '../services/box/catalog.js';
import { checkoutBoxOrder } from '../services/box/checkout.js';
import { confirmBox } from '../services/box/confirm.js';
import { listBoxHistory } from '../services/box/history.js';
import { setBoxPreferences } from '../services/box/preferences.js';
import { recalcBoxTotals } from '../services/box/recalc.js';
import { serializeBox } from '../services/box/serialize.js';
import { skipBox, unskipBox } from '../services/box/skip.js';

const BOX_INCLUDE = {
  items: { include: { catalogItem: true } },
  partnerItems: { include: { partnerModule: true } },
} as const;
const ELIGIBLE_STATUSES = ['active', 'trialing'] as const;

/** user -> garage -> latest eligible membership. Null when none qualifies. */
export const loadEligibleMembership = async (
  userId: string,
): Promise<{ id: string; tier: GaragePremiumTier } | null> => {
  const garage = await prisma.garage.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!garage) return null;
  const membership = await prisma.premiumMembership.findFirst({
    where: { garageId: garage.id, status: { in: [...ELIGIBLE_STATUSES] } },
    orderBy: { currentPeriodEnd: 'desc' },
    select: { id: true, tier: true },
  });
  return membership;
};

export const boxRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/boxes', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const garage = await prisma.garage.findUnique({ where: { userId: sub }, select: { id: true } });
    if (!garage) return reply.send([]);
    return reply.send(await listBoxHistory(app.uploads, garage.id));
  });

  app.get('/me/box/catalog', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
    const box = await prisma.monthlyBox.findFirst({
      where: { membershipId: membership.id },
      orderBy: { cycleStart: 'desc' },
      select: { cycleKey: true },
    });
    if (!box) return reply.status(404).send({ error: 'box_not_open' });
    return reply.send(await buildBoxCatalog(app.uploads, box.cycleKey, membership.tier));
  });

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
    return reply.send(serializeBox(box, app.uploads));
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
      select: { id: true, garageId: true },
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
        // Lock the Garage row — same resource the cutoff worker locks — so all three paths serialize.
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRef.garageId} FOR UPDATE`;
        const locked = await tx.monthlyBox.findUnique({
          where: { id: boxRef.id },
          select: { status: true, cutoffAt: true },
        });
        // Box locks at the cutoff instant even if the cron worker has not processed it yet.
        if (!locked || locked.status !== 'open' || locked.cutoffAt <= new Date()) {
          throw new BoxLockedError();
        }

        // Re-read the tier under the Garage lock: `membership.tier` was read
        // before the transaction, and a concurrent downgrade could have
        // committed while this request waited for the lock.
        const member = await tx.premiumMembership.findUniqueOrThrow({
          where: { id: membership.id },
          select: { tier: true },
        });

        // Sweep selections the member can no longer see/edit (downgrade or a
        // post-hoc minTier). They cannot be removed from the client, so drop
        // them here so the builder totals stay honest.
        const existing = await tx.monthlyBoxItem.findMany({
          where: { boxId: boxRef.id, included: true },
        });
        for (const line of existing) {
          const item = await tx.boxCatalogItem.findUnique({ where: { id: line.catalogItemId } });
          if (item && !meetsMinTier(member.tier, item.minTier)) {
            await tx.monthlyBoxItem.deleteMany({
              where: { boxId: boxRef.id, catalogItemId: line.catalogItemId },
            });
          }
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
          if (!meetsMinTier(member.tier, item.minTier)) continue; // gated: silently ignore
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
      include: BOX_INCLUDE,
    });
    return reply.send(serializeBox(fresh, app.uploads));
  });

  app.post('/me/box/skip', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
    const result = await skipBox(membership.id);
    if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
    if (result.kind === 'conflict') return reply.status(409).send({ error: 'box_locked' });
    return reply.status(204).send();
  });

  app.post('/me/box/unskip', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
    const result = await unskipBox(membership.id);
    if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
    if (result.kind === 'conflict') return reply.status(409).send({ error: 'box_locked' });
    return reply.status(204).send();
  });

  app.put('/me/box/preferences', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = boxPreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
    const result = await setBoxPreferences({
      userId: sub,
      membershipId: membership.id,
      autoSendOptIn: parsed.data.autoSendOptIn,
      ...(parsed.data.shippingAddressId
        ? { shippingAddressId: parsed.data.shippingAddressId }
        : {}),
    });
    if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
    if (result.kind === 'bad_address') return reply.status(400).send({ error: 'bad_address' });
    if (result.kind === 'conflict') return reply.status(409).send({ error: 'box_locked' });
    return reply.status(204).send();
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
    });
    if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
    if (result.kind === 'not_open') return reply.status(409).send({ error: 'box_locked' });
    if (result.kind === 'bad_address') return reply.status(400).send({ error: 'bad_address' });
    if (result.kind === 'empty') return reply.status(422).send({ error: 'box_empty' });

    const fresh = await prisma.monthlyBox.findUniqueOrThrow({
      where: { id: result.boxId },
      include: BOX_INCLUDE,
    });
    return reply.send(serializeBox(fresh, app.uploads));
  });

  // hook: 'preHandler' is required because the keyGenerator reads
  // request.user, which only exists after app.authenticate runs. Without it
  // the rate-limit plugin keys on the earlier onRequest hook and falls back
  // to req.ip, rate-limiting every user behind one NAT as a single caller.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `box-checkout:${req.user?.sub ?? req.ip}`,
    });
    scoped.post('/me/box/checkout', async (request, reply) => {
      const { sub } = requireUser(request);
      if (!app.abacatepay) return reply.status(503).send({ error: 'payment_unavailable' });
      const membership = await loadEligibleMembership(sub);
      if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
      const result = await checkoutBoxOrder({
        userId: sub,
        membershipId: membership.id,
        abacatepay: app.abacatepay,
      });
      if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
      if (result.kind === 'not_awaiting')
        return reply.status(409).send({ error: 'box_not_awaiting' });
      if (result.kind === 'locked') return reply.status(409).send({ error: 'box_locked' });
      if (result.kind === 'upstream')
        return reply.status(502).send({ error: 'payment_provider_error' });
      return reply.send({
        brCode: result.brCode,
        amountCents: result.amountCents,
        expiresAt: result.expiresAt,
      });
    });
  });
};
