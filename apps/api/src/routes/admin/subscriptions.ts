/**
 * Controle administrativo de assinaturas.
 *
 *   GET    /admin/subscriptions/:id                    detalhe
 *   POST   /admin/subscriptions/:id/plan               troca de plano
 *   POST   /admin/subscriptions/:id/addons             vincula modulo
 *   DELETE /admin/subscriptions/:id/addons/:addonKey   desvincula modulo
 *   POST   /admin/subscriptions/:id/cancel             cancela ao fim do periodo
 *   POST   /admin/subscriptions/:id/resume             retoma cancelamento OU cobranca
 *   POST   /admin/subscriptions/:id/pause              pausa cobranca
 *
 * Modelo hibrido: as mutacoes chamam a Stripe e NAO escrevem status. Quem escreve
 * e o webhook verificado. Assinatura apple_revenuecat e somente leitura.
 *
 * A LISTA nao mora aqui: ela reusa GET /admin/finance/memberships.
 */

import { prisma } from '@ccc/db';
import {
  ADMIN_SUBSCRIPTION_ALLOWED_STATUS,
  type AdminSubscriptionAction,
  adminSubscriptionActionResponseSchema,
  adminSubscriptionAddonAttachSchema,
  adminSubscriptionAddonMutationResponseSchema,
  adminSubscriptionChangePlanSchema,
  adminSubscriptionDetailSchema,
} from '@ccc/shared/admin-subscription';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { recordAudit } from '../../services/admin-audit.js';
import { attachAddon, detachAddon } from '../../services/billing/addons.js';
import { isBillingActionError } from '../../services/billing/errors.js';
import {
  changePlan,
  pauseCollection,
  resumeCancel,
  resumeCollection,
  scheduleCancel,
} from '../../services/billing/subscription-actions.js';
import { requireUser } from '../../plugins/auth.js';

export const adminSubscriptionRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /admin/subscriptions/:id
   *
   * Deliberadamente NAO gateado por GROWTH_PREMIUM_BILLING_ENABLED: o admin
   * precisa inspecionar assinaturas mesmo com a flag desligada. So as mutacoes
   * sao bloqueadas.
   */
  app.get('/subscriptions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const membership = await prisma.premiumMembership.findUnique({
      where: { id },
      include: {
        garage: {
          select: { id: true, slug: true, user: { select: { id: true, name: true, email: true } } },
        },
        addons: {
          orderBy: { createdAt: 'asc' },
          include: {
            module: { select: { name: true } },
            usage: { orderBy: { cycleStart: 'desc' }, take: 1 },
          },
        },
        invoices: { orderBy: { periodStart: 'desc' } },
      },
    });

    if (!membership) {
      return reply.status(404).send({ error: 'NotFound', message: 'subscription not found' });
    }

    const plan = await prisma.premiumPlan.findUnique({ where: { tier: membership.tier } });

    const totalAmountCents = membership.baseAmountCents + membership.addonsAmountCents;

    return reply.status(200).send(
      adminSubscriptionDetailSchema.parse({
        membershipId: membership.id,
        userId: membership.garage.user.id,
        userName: membership.garage.user.name ?? '',
        userEmail: membership.garage.user.email,
        garageId: membership.garage.id,
        garageSlug: membership.garage.slug ?? '',
        tier: membership.tier,
        planSlug: plan?.slug ?? null,
        planName: plan?.name ?? null,
        cadence: membership.cadence,
        status: membership.status,
        provider: membership.provider,
        currentPeriodStart: membership.currentPeriodStart.toISOString(),
        currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
        cancelledAt: membership.cancelledAt?.toISOString() ?? null,
        baseAmountCents: membership.baseAmountCents,
        addonsAmountCents: membership.addonsAmountCents,
        totalAmountCents,
        currency: membership.currency,
        paymentBrand: membership.paymentBrand,
        paymentLast4: membership.paymentLast4,
        // Apple e dona da assinatura: nossa API nao pode muta-la.
        mutable: membership.provider === 'stripe',
        addons: membership.addons.map((addon) => {
          const cycle = addon.usage[0] ?? null;
          return {
            key: addon.addonKey,
            name: addon.module.name,
            vendorName: addon.vendorName,
            status: addon.status,
            quotaUnit: addon.quotaUnit,
            quotaPerCycle: addon.quotaPerCycle,
            monthlyDeltaCents: addon.monthlyDeltaCents,
            payoutAmountCents: addon.payoutAmountCents,
            marginCents: addon.monthlyDeltaCents - addon.payoutAmountCents,
            // Falso = a Stripe nao esta cobrando por este modulo, apesar de ele
            // somar no total local. A UI avisa o admin.
            billingIntegrated: addon.providerItemRef !== null,
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
        invoices: membership.invoices.map((inv) => ({
          periodStart: inv.periodStart.toISOString(),
          periodEnd: inv.periodEnd.toISOString(),
          paidAt: inv.paidAt.toISOString(),
          grossAmountCents: inv.grossAmountCents,
          addonsAmountCents: inv.addonsAmountCents,
          currency: inv.currency,
          status: inv.status,
          refundedAt: inv.refundedAt?.toISOString() ?? null,
          refundedAmountCents: inv.refundedAmountCents,
        })),
      }),
    );
  });

  type MembershipStatus = Awaited<
    ReturnType<typeof prisma.premiumMembership.findUniqueOrThrow>
  >['status'];

  /**
   * As listas vivem em @ccc/shared para o admin desabilitar o controle com o
   * mesmo criterio que a API usa para recusar. Esta atribuicao e a guarda de
   * drift: se o enum do Prisma e o do shared divergirem, quebra a compilacao
   * aqui em vez de virar 409 no clique.
   */
  const ALLOWED_STATUS: Record<
    AdminSubscriptionAction,
    ReadonlyArray<MembershipStatus>
  > = ADMIN_SUBSCRIPTION_ALLOWED_STATUS;

  /**
   * Ordem de avaliacao: existencia, flag, status, provider.
   *
   * Status antes de provider de proposito: o admin recebe o motivo mais
   * especifico. Uma assinatura Apple expirada acusa o status, nao o provider.
   */
  const loadMutable = async (
    id: string,
    action: keyof typeof ALLOWED_STATUS,
    reply: FastifyReply,
  ) => {
    const membership = await prisma.premiumMembership.findUnique({ where: { id } });
    if (!membership) {
      void reply.status(404).send({ error: 'NotFound', message: 'subscription not found' });
      return null;
    }
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      void reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      return null;
    }
    if (!ALLOWED_STATUS[action].includes(membership.status)) {
      void reply.status(409).send({
        error: 'InvalidStatus',
        message: `action not allowed while subscription is ${membership.status}`,
        status: membership.status,
      });
      return null;
    }
    if (membership.provider !== 'stripe') {
      void reply.status(409).send({
        error: 'ProviderNotMutable',
        message: 'subscription is managed by the App Store and cannot be changed here',
      });
      return null;
    }
    return membership;
  };

  /** Traduz BillingActionError para o corpo de resposta desta superficie. */
  const sendBillingError = (err: unknown, reply: FastifyReply): boolean => {
    if (!isBillingActionError(err)) return false;
    const errorName =
      err.code === 'MembershipNotFound' || err.code === 'ModuleNotFound' ? 'NotFound' : err.code;
    void reply.status(err.httpStatus).send({ error: errorName, message: err.message });
    return true;
  };

  app.post('/subscriptions/:id/plan', async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await loadMutable(id, 'plan', reply);
    if (!membership) return reply;

    const parsed = adminSubscriptionChangePlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    try {
      await changePlan({
        membershipId: id,
        tier: parsed.data.tier,
        cadence: parsed.data.cadence,
        stripe: app.stripe,
      });
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    const { sub } = requireUser(request);
    await recordAudit({
      actorId: sub,
      action: 'premium.subscription.plan_changed',
      entityType: 'premium_membership',
      entityId: id,
      metadata: {
        fromTier: membership.tier,
        fromCadence: membership.cadence,
        toTier: parsed.data.tier,
        toCadence: parsed.data.cadence,
      },
    });

    return reply
      .status(200)
      .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
  });

  app.post('/subscriptions/:id/addons', async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await loadMutable(id, 'addon', reply);
    if (!membership) return reply;

    const parsed = adminSubscriptionAddonAttachSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    let result;
    try {
      result = await attachAddon({
        membershipId: id,
        addonKey: parsed.data.addonKey,
        stripe: app.stripe,
        logger: request.log,
      });
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    const { sub } = requireUser(request);
    await recordAudit({
      actorId: sub,
      action: 'premium.subscription.addon_attached',
      entityType: 'premium_membership',
      entityId: id,
      metadata: { addonKey: parsed.data.addonKey, addonsAmountCents: result.addonsAmountCents },
    });

    // pending false: attach grava no banco na hora, depois da chamada a Stripe.
    return reply
      .status(201)
      .send(
        adminSubscriptionAddonMutationResponseSchema.parse({ ok: true, pending: false, ...result }),
      );
  });

  app.delete('/subscriptions/:id/addons/:addonKey', async (request, reply) => {
    const { id, addonKey } = request.params as { id: string; addonKey: string };
    const membership = await loadMutable(id, 'addon', reply);
    if (!membership) return reply;

    let result;
    try {
      result = await detachAddon({
        membershipId: id,
        addonKey,
        stripe: app.stripe,
        logger: request.log,
      });
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    const { sub } = requireUser(request);
    await recordAudit({
      actorId: sub,
      action: 'premium.subscription.addon_detached',
      entityType: 'premium_membership',
      entityId: id,
      metadata: { addonKey, addonsAmountCents: result.addonsAmountCents },
    });

    return reply
      .status(200)
      .send(
        adminSubscriptionAddonMutationResponseSchema.parse({ ok: true, pending: false, ...result }),
      );
  });

  app.post('/subscriptions/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await loadMutable(id, 'cancel', reply);
    if (!membership) return reply;

    try {
      await scheduleCancel({ membershipId: id, stripe: app.stripe });
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    const { sub } = requireUser(request);
    await recordAudit({
      actorId: sub,
      action: 'premium.subscription.cancel_scheduled',
      entityType: 'premium_membership',
      entityId: id,
      metadata: { fromStatus: membership.status },
    });

    return reply
      .status(200)
      .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
  });

  /**
   * Um unico botao na interface. O backend decide pelo estado atual: retomar um
   * cancelamento agendado e retomar uma cobranca pausada sao acoes diferentes na
   * Stripe, mas a mesma intencao para quem opera.
   */
  app.post('/subscriptions/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await loadMutable(id, 'resume', reply);
    if (!membership) return reply;

    try {
      if (membership.status === 'cancel_scheduled') {
        await resumeCancel({ membershipId: id, stripe: app.stripe });
      } else {
        await resumeCollection({ membershipId: id, stripe: app.stripe });
      }
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    const { sub } = requireUser(request);
    await recordAudit({
      actorId: sub,
      action: 'premium.subscription.resumed',
      entityType: 'premium_membership',
      entityId: id,
      metadata: { fromStatus: membership.status },
    });

    return reply
      .status(200)
      .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
  });

  app.post('/subscriptions/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const membership = await loadMutable(id, 'pause', reply);
    if (!membership) return reply;

    try {
      await pauseCollection({ membershipId: id, stripe: app.stripe });
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    const { sub } = requireUser(request);
    await recordAudit({
      actorId: sub,
      action: 'premium.subscription.paused',
      entityType: 'premium_membership',
      entityId: id,
      metadata: { fromStatus: membership.status },
    });

    return reply
      .status(200)
      .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
  });
};
