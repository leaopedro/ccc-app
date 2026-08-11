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
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { attachAddon, detachAddon } from '../services/billing/addons.js';
import { isBillingActionError } from '../services/billing/errors.js';

/**
 * Live membership statuses — the same set me-premium.ts treats as "blocks a new
 * subscription". `expired`/`paused`/`trialing` are intentionally excluded from
 * add-on attach/detach.
 */
const LIVE_STATUSES = ['active', 'past_due', 'cancel_scheduled'] as const;

/** Add-on statuses that still count as attached (billable or winding down). */
const ATTACHED_ADDON_STATUSES = ['active', 'cancel_scheduled'] as const;

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
            planDescription: null,
            benefits: [],
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
          planDescription: plan?.description ?? null,
          benefits: plan?.benefits.map((b) => b.label) ?? [],
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
  const attachAddonHandler = async (request: FastifyRequest, reply: FastifyReply) => {
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

    try {
      const result = await attachAddon({
        membershipId: membership.id,
        addonKey,
        stripe: app.stripe,
        logger: request.log,
      });
      return reply.status(201).send(addonMutationResponseSchema.parse(result));
    } catch (err) {
      if (isBillingActionError(err)) {
        // Explicit mapping to preserve EXACTLY the codes and messages this
        // endpoint already returned before the service extraction. The
        // pre-existing test suite for me-premium-addons is the proof of that
        // and must not be edited.
        if (err.code === 'ModuleNotFound') {
          return reply.status(404).send({ error: 'NotFound', message: 'add-on module not found' });
        }
        if (err.code === 'AddonAlreadyAttached') {
          return reply
            .status(409)
            .send({ error: 'AlreadyExists', message: 'add-on already attached' });
        }
      }
      throw err;
    }
  };

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

      try {
        const result = await detachAddon({
          membershipId: membership.id,
          addonKey,
          stripe: app.stripe,
          logger: request.log,
        });
        return reply.status(200).send(addonMutationResponseSchema.parse(result));
      } catch (err) {
        if (isBillingActionError(err) && err.code === 'AddonNotAttached') {
          return reply.status(404).send({ error: 'NotFound', message: 'add-on not attached' });
        }
        throw err;
      }
    },
  );

  // hook: 'preHandler' is required because the keyGenerator reads
  // request.user, which only exists after app.authenticate runs. Without it
  // the rate-limit plugin keys on the earlier onRequest hook and falls back
  // to req.ip, rate-limiting every user behind one NAT as a single caller.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 20,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `premium-addons:${req.user?.sub ?? req.ip}`,
    });
    scoped.post('/api/me/premium/addons', attachAddonHandler);
  });
};
