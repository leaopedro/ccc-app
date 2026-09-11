/**
 * me-premium-addons routes — member subscription read + add-on attach/detach.
 *
 *   GET    /api/me/premium/subscription        — current membership + add-ons
 *   POST   /api/me/premium/addons              — attach an add-on module
 *   DELETE /api/me/premium/addons/:addonKey    — schedule add-on cancellation
 *
 * All endpoints gate on env.GROWTH_PREMIUM_BILLING_ENABLED (503 when off) and
 * require app.authenticate, mirroring me-premium.ts. POST (attach) also runs
 * requireSubscriptionsEnabled: attaching a new paid add-on is a purchase
 * entry point, same family as /checkout. DELETE (detach) and GET do not —
 * they let an existing payer reduce or view what they already bought. Both
 * POST and DELETE sit behind the same per-user rate limit (real Stripe calls
 * on every hit); GET does not need one.
 *
 * Attach also guards on the membership itself: non-Stripe providers (409
 * NotStripeSubscription, with the App Store manageUrl) and statuses outside
 * MEMBER_ADDON_ATTACH_STATUS (409 InvalidStatus) are refused before
 * attachAddon runs, so a paused/past_due member or an Apple subscriber never
 * gets a paid module for free. Detach only guards on provider — reducing a
 * commitment is never blocked by status.
 *
 * Provider billing (P5): attach/detach wire Stripe subscription items when the
 * membership is Stripe-backed AND the module has a stripePriceId. Provider calls
 * run provider-first (before the DB tx) so a Stripe failure never corrupts local
 * state. When there is no Stripe sub ref or no module stripePriceId, the flow
 * stays local-only (providerItemRef null) and logs — it does not throw.
 */

import { prisma } from '@ccc/db';
import { APPLE_MANAGE_URL } from '@ccc/shared/premium';
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
import { pickLiveMembership } from '../services/billing/live-membership.js';
import { requireSubscriptionsEnabled } from '../services/platform-gate/guard.js';

/** Add-on statuses that still count as attached (billable or winding down). */
const ATTACHED_ADDON_STATUSES = ['active', 'cancel_scheduled'] as const;

/**
 * Mesma lista da troca de plano (me-premium.ts). Mais estrita que a do admin,
 * que aceita past_due: quem tem cobranca pendente regulariza antes de assumir
 * compromisso novo. Vale so para o ATTACH — detach reduz compromisso e nao
 * pode ser barrado por inadimplencia.
 */
const MEMBER_ADDON_ATTACH_STATUS = ['active', 'cancel_scheduled'] as const;

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

      const membership = await pickLiveMembership(prisma, garage.id);

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
            status: null,
            provider: null,
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
          status: membership.status,
          provider: membership.provider,
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
              monthlyDeltaCents: addon.monthlyDeltaCents,
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

    const membership = await pickLiveMembership(prisma, garage.id);
    if (!membership) {
      return reply
        .status(409)
        .send({ error: 'NoActiveMembership', message: 'no live membership to attach to' });
    }

    if (membership.provider !== 'stripe') {
      return reply.status(409).send({
        error: 'NotStripeSubscription',
        message: 'manage your subscription in the App Store',
        manageUrl: APPLE_MANAGE_URL,
      });
    }

    if (!(MEMBER_ADDON_ATTACH_STATUS as readonly string[]).includes(membership.status)) {
      return reply.status(409).send({
        error: 'InvalidStatus',
        message: `add-on attach not allowed while subscription is ${membership.status}`,
        status: membership.status,
      });
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
  const detachAddonHandler = async (request: FastifyRequest, reply: FastifyReply) => {
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

    const membership = await pickLiveMembership(prisma, garage.id);
    if (!membership) {
      return reply.status(404).send({ error: 'NotFound', message: 'no live membership' });
    }

    if (membership.provider !== 'stripe') {
      return reply.status(409).send({
        error: 'NotStripeSubscription',
        message: 'manage your subscription in the App Store',
        manageUrl: APPLE_MANAGE_URL,
      });
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
  };

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
    scoped.post(
      '/api/me/premium/addons',
      { preHandler: requireSubscriptionsEnabled },
      attachAddonHandler,
    );
    // No requireSubscriptionsEnabled here on purpose: detach reduces an
    // existing commitment, not a purchase, so it is not gated by platform.
    // me-premium-addons-platform-gate.test.ts asserts exactly this.
    scoped.delete('/api/me/premium/addons/:addonKey', detachAddonHandler);
  });
};
