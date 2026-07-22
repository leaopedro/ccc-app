/**
 * me-premium-addons routes — member subscription read + add-on attach/detach.
 *
 *   GET    /api/me/premium/subscription        — current membership + add-ons
 *   POST   /api/me/premium/addons              — attach an add-on module
 *   DELETE /api/me/premium/addons/:addonKey    — schedule add-on cancellation
 *
 * All endpoints gate on env.GROWTH_PREMIUM_BILLING_ENABLED (503 when off) and
 * require app.authenticate, mirroring me-premium.ts.
 *
 * Provider billing (P5): attach/detach wire Stripe subscription items when the
 * membership is Stripe-backed AND the module has a stripePriceId. Provider calls
 * run provider-first (before the DB tx) so a Stripe failure never corrupts local
 * state. When there is no Stripe sub ref or no module stripePriceId, the flow
 * stays local-only (providerItemRef null) and logs — it does not throw.
 */

import { prisma } from '@ccc/db';
import {
  addonMutationResponseSchema,
  attachAddonRequestSchema,
  mySubscriptionResponseSchema,
} from '@ccc/shared/premium-subscription';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

/**
 * Live membership statuses — the same set me-premium.ts treats as "blocks a new
 * subscription". `expired`/`paused`/`trialing` are intentionally excluded from
 * add-on attach/detach.
 */
const LIVE_STATUSES = ['active', 'past_due', 'cancel_scheduled'] as const;

/** Add-on statuses that still count as attached (billable or winding down). */
const ATTACHED_ADDON_STATUSES = ['active', 'cancel_scheduled'] as const;

// eslint-disable-next-line @typescript-eslint/require-await
export const mePremiumAddonRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/me/premium/subscription
   *
   * Resolves the user's garage → most-recent live membership → its plan (for
   * slug/name) → attached add-ons with their current-cycle usage. Returns
   * mySubscriptionResponseSchema. 404 when the user has no garage. When there
   * is no live membership, returns active=false with empty add-ons.
   */
  app.get(
    '/api/me/premium/subscription',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);

      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });
      if (!garage) {
        return reply.status(404).send({ error: 'NotFound', message: 'Garage not found.' });
      }

      const membership = await prisma.premiumMembership.findFirst({
        where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      if (!membership) {
        return reply.status(200).send(
          mySubscriptionResponseSchema.parse({
            active: false,
            tier: null,
            planSlug: null,
            planName: null,
            cadence: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            baseAmountCents: 0,
            addonsAmountCents: 0,
            totalAmountCents: 0,
            currency: 'BRL',
            addons: [],
          }),
        );
      }

      // Plan is display metadata only (slug/name). Prices/benefits are included
      // per spec but the billed base amount comes from the membership snapshot.
      const plan = await prisma.premiumPlan.findUnique({
        where: { tier: membership.tier },
        include: {
          prices: { where: { cadence: membership.cadence } },
          benefits: { orderBy: { sortOrder: 'asc' } },
        },
      });

      const addons = await prisma.premiumMembershipAddon.findMany({
        where: { membershipId: membership.id, status: { in: [...ATTACHED_ADDON_STATUSES] } },
        orderBy: { createdAt: 'asc' },
        include: {
          module: { select: { name: true } },
          usage: { orderBy: { cycleStart: 'desc' }, take: 1 },
        },
      });

      const addonsAmountCents = membership.addonsAmountCents;
      const totalAmountCents = membership.baseAmountCents + addonsAmountCents;

      return reply.status(200).send(
        mySubscriptionResponseSchema.parse({
          active: true,
          tier: membership.tier,
          planSlug: plan?.slug ?? null,
          planName: plan?.name ?? null,
          cadence: membership.cadence,
          currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
          baseAmountCents: membership.baseAmountCents,
          addonsAmountCents,
          totalAmountCents,
          currency: membership.currency,
          addons: addons.map((addon) => {
            const cycle = addon.usage[0] ?? null;
            return {
              key: addon.addonKey,
              name: addon.module.name,
              status: addon.status,
              quotaUnit: addon.quotaUnit,
              quotaPerCycle: addon.quotaPerCycle,
              currentCycle: cycle
                ? {
                    cycleStart: cycle.cycleStart.toISOString(),
                    cycleEnd: cycle.cycleEnd.toISOString(),
                    quotaTotal: cycle.quotaTotal,
                    quotaUsed: cycle.quotaUsed,
                    quotaRemaining: cycle.quotaTotal - cycle.quotaUsed,
                  }
                : null,
            };
          }),
        }),
      );
    },
  );

  /**
   * POST /api/me/premium/addons
   *
   * Body: { addonKey }. Attaches an add-on module to the user's live membership,
   * snapshotting the module's price/quota so later catalog edits don't change an
   * active add-on. Opens the first usage cycle aligned to the membership period.
   */
  app.post('/api/me/premium/addons', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const { sub } = requireUser(request);

    const parsed = attachAddonRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const { addonKey } = parsed.data;

    const garage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: { id: true },
    });
    if (!garage) {
      return reply.status(404).send({ error: 'NotFound', message: 'Garage not found.' });
    }

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!membership) {
      return reply
        .status(409)
        .send({ error: 'NoActiveMembership', message: 'no live membership to attach to' });
    }

    const module = await prisma.premiumAddonModule.findUnique({ where: { key: addonKey } });
    if (!module || !module.active) {
      return reply.status(404).send({ error: 'NotFound', message: 'add-on module not found' });
    }

    const existing = await prisma.premiumMembershipAddon.findUnique({
      where: { membershipId_addonKey: { membershipId: membership.id, addonKey } },
    });
    if (existing && existing.status !== 'cancelled') {
      return reply.status(409).send({ error: 'AlreadyExists', message: 'add-on already attached' });
    }

    const cycleStart = membership.currentPeriodStart ?? new Date();
    const cycleEnd = membership.currentPeriodEnd;

    // P5 provider seam — provider-first ordering:
    // Create the Stripe subscription item BEFORE the DB transaction. A Stripe
    // failure throws here and leaves local state untouched (no compensation
    // needed). The rare orphan case (Stripe ok, DB tx fails afterwards) is
    // reconciled by the addons webhook sync + the reconcile worker.
    // Local-only fallback (no throw) when the membership has no Stripe
    // subscription ref OR the module has no stripePriceId configured.
    let providerItemRef: string | null = null;
    const stripeBacked = membership.provider === 'stripe' && Boolean(membership.providerSubRef);
    if (stripeBacked && module.stripePriceId) {
      const item = await app.stripe.addSubscriptionItem({
        subscriptionId: membership.providerSubRef,
        priceId: module.stripePriceId,
        idempotencyKey: `addon_attach_${membership.id}_${addonKey}`,
      });
      providerItemRef = item.subscriptionItemId;
    } else {
      request.log.info(
        {
          membershipId: membership.id,
          addonKey,
          provider: membership.provider,
          hasStripePrice: Boolean(module.stripePriceId),
        },
        'me-premium-addons: attach local-only (no stripe sub ref or module stripePriceId)',
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (existing) {
        // Re-attach a previously cancelled add-on: refresh the snapshot back to
        // the current module terms and re-open a usage cycle for this period.
        await tx.premiumMembershipAddon.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            providerItemRef,
            monthlyDeltaCents: module.monthlyDeltaCents,
            quotaPerCycle: module.quotaPerCycle,
            quotaUnit: module.quotaUnit,
            currency: module.currency,
          },
        });
        await tx.premiumAddonUsage.upsert({
          where: {
            membershipAddonId_cycleStart: { membershipAddonId: existing.id, cycleStart },
          },
          create: {
            membershipAddonId: existing.id,
            cycleStart,
            cycleEnd,
            quotaTotal: module.quotaPerCycle,
            quotaUsed: 0,
          },
          update: {},
        });
      } else {
        const created = await tx.premiumMembershipAddon.create({
          data: {
            membershipId: membership.id,
            addonKey,
            status: 'active',
            providerItemRef,
            monthlyDeltaCents: module.monthlyDeltaCents,
            quotaPerCycle: module.quotaPerCycle,
            quotaUnit: module.quotaUnit,
            currency: module.currency,
          },
        });
        await tx.premiumAddonUsage.create({
          data: {
            membershipAddonId: created.id,
            cycleStart,
            cycleEnd,
            quotaTotal: module.quotaPerCycle,
            quotaUsed: 0,
          },
        });
      }

      const agg = await tx.premiumMembershipAddon.aggregate({
        where: { membershipId: membership.id, status: 'active' },
        _sum: { monthlyDeltaCents: true },
      });
      const addonsAmountCents = agg._sum.monthlyDeltaCents ?? 0;

      await tx.premiumMembership.update({
        where: { id: membership.id },
        data: { addonsAmountCents },
      });

      return { addonsAmountCents };
    });

    return reply.status(201).send(
      addonMutationResponseSchema.parse({
        addonKey,
        status: 'active',
        addonsAmountCents: result.addonsAmountCents,
        totalAmountCents: membership.baseAmountCents + result.addonsAmountCents,
      }),
    );
  });

  /**
   * DELETE /api/me/premium/addons/:addonKey
   *
   * Sets the add-on status to cancel_scheduled (never hard-deletes — usage
   * history is preserved). Recomputes addonsAmountCents from active add-ons
   * only. 404 when the add-on is not attached.
   */
  app.delete(
    '/api/me/premium/addons/:addonKey',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);
      const { addonKey } = request.params as { addonKey: string };

      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });
      if (!garage) {
        return reply.status(404).send({ error: 'NotFound', message: 'Garage not found.' });
      }

      const membership = await prisma.premiumMembership.findFirst({
        where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!membership) {
        return reply.status(404).send({ error: 'NotFound', message: 'no live membership' });
      }

      const addon = await prisma.premiumMembershipAddon.findUnique({
        where: { membershipId_addonKey: { membershipId: membership.id, addonKey } },
      });
      if (!addon || !(ATTACHED_ADDON_STATUSES as readonly string[]).includes(addon.status)) {
        return reply.status(404).send({ error: 'NotFound', message: 'add-on not attached' });
      }

      // P5 provider seam — provider-first ordering (mirrors attach):
      // Remove the Stripe subscription item BEFORE the DB transaction. A Stripe
      // failure throws here and leaves the add-on row untouched. The Stripe item
      // is deleted immediately with proration (see removeSubscriptionItem); the
      // local row is set to `cancel_scheduled` so the member keeps quota through
      // period end while Stripe stops billing — a deliberate simplification.
      // Local-only fallback (no throw) when there is no provider item to remove.
      if (membership.provider === 'stripe' && addon.providerItemRef) {
        await app.stripe.removeSubscriptionItem({
          subscriptionItemId: addon.providerItemRef,
          idempotencyKey: `addon_detach_${addon.id}`,
        });
      } else {
        request.log.info(
          { membershipId: membership.id, addonKey, provider: membership.provider },
          'me-premium-addons: detach local-only (no provider item ref)',
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.premiumMembershipAddon.update({
          where: { id: addon.id },
          data: { status: 'cancel_scheduled' },
        });

        const agg = await tx.premiumMembershipAddon.aggregate({
          where: { membershipId: membership.id, status: 'active' },
          _sum: { monthlyDeltaCents: true },
        });
        const addonsAmountCents = agg._sum.monthlyDeltaCents ?? 0;

        await tx.premiumMembership.update({
          where: { id: membership.id },
          data: { addonsAmountCents },
        });

        return { addonsAmountCents };
      });

      return reply.status(200).send(
        addonMutationResponseSchema.parse({
          addonKey,
          status: 'cancel_scheduled',
          addonsAmountCents: result.addonsAmountCents,
          totalAmountCents: membership.baseAmountCents + result.addonsAmountCents,
        }),
      );
    },
  );
};
