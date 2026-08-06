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
import { adminSubscriptionDetailSchema } from '@ccc/shared/admin-subscription';
import type { FastifyPluginAsync } from 'fastify';

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
        garage: { select: { id: true, slug: true, user: { select: { id: true, name: true, email: true } } } },
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
};
