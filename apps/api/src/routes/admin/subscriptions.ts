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
 *   POST   /admin/subscriptions/grant                  recuperacao manual (Runbook 5)
 *
 * Modelo hibrido: as mutacoes chamam a Stripe e NAO escrevem status. Quem escreve
 * e o webhook verificado. Assinatura apple_revenuecat e somente leitura.
 *
 * A excecao e /grant: escreve entitlement paga direto no banco, sem passar pela
 * Stripe. Por isso ela NAO mora em `adminSubscriptionRoutes` — vive no plugin
 * separado `adminSubscriptionGrantRoutes`, registrado no bloco
 * requireRole('admin') com bucket proprio de rate limit (routes/admin/index.ts).
 * Todas as rotas acima dela continuam organizer/admin. Detalhe no comentario do
 * proprio plugin.
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
  adminSubscriptionGrantResponseSchema,
  adminSubscriptionGrantSchema,
} from '@ccc/shared/admin-subscription';
import { LIVE_MEMBERSHIP_STATUSES } from '@ccc/shared/premium';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { recordAudit } from '../../services/admin-audit.js';
import { attachAddon, detachAddon } from '../../services/billing/addons.js';
import {
  applyMembershipEvent,
  enqueuePremiumTicketBackfillIfActivated,
} from '../../services/billing/apply-membership-event.js';
import { BillingActionError, isBillingActionError } from '../../services/billing/errors.js';
import {
  changePlan,
  pauseCollection,
  resumeCancel,
  resumeCollection,
  scheduleCancel,
} from '../../services/billing/subscription-actions.js';
import type { BillingEvent } from '../../services/billing/types.js';
import { requireUser } from '../../plugins/auth.js';

/**
 * Traduz BillingActionError para o corpo de resposta desta superficie.
 *
 * Em escopo de modulo (nao mais dentro de adminSubscriptionRoutes) porque o
 * grant passou a viver em outro plugin — ver adminSubscriptionGrantRoutes.
 */
const sendBillingError = (err: unknown, reply: FastifyReply): boolean => {
  if (!isBillingActionError(err)) return false;
  const errorName =
    err.code === 'MembershipNotFound' || err.code === 'ModuleNotFound' ? 'NotFound' : err.code;
  void reply.status(err.httpStatus).send({ error: errorName, message: err.message });
  return true;
};

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

/**
 * Grant de recuperacao (Runbook 5), num plugin separado DE PROPOSITO.
 *
 * Fix round 2, IMPORTANT (buraco de autorizacao): esta rota vivia dentro de
 * adminSubscriptionRoutes, registrado no escopo requireRole('organizer',
 * 'admin') em routes/admin/index.ts — ou seja, qualquer organizer podia
 * cunhar uma PremiumMembership paga, sua invoice, o snapshot
 * Garage.premiumTier/premiumUntil, o XP e o backfill de ingressos. E a
 * escrita mais poderosa desta branch, e era a menos protegida: a rota de
 * reembolso, estritamente mais fraca, ja estava atras de requireRole('admin')
 * com bucket proprio de rate limit.
 *
 * Separar em outro plugin e o que permite registrar so ele no bloco
 * admin-only, com bucket de rate limit proprio. O resto do arquivo (leitura e
 * mutacoes que passam pela Stripe e nao escrevem status) continua
 * organizer/admin.
 */
export const adminSubscriptionGrantRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /admin/subscriptions/grant
   *
   * Mechanises Runbook 5 of docs/observability.md ("Money in, nothing out"):
   * the member paid, the webhook did not produce a membership
   * (unknown-plan-price, or an event marked processed before the catalog
   * existed), and someone has to put the row in by hand.
   *
   * This is NOT a hole in "memberships only ever come from a verified
   * webhook". That invariant exists to stop a CLIENT from minting
   * entitlement. This route is admin-authenticated, gated by
   * requireRole('admin') — NOT the organizer/admin scope the rest of this
   * file uses — rate-limited in its own bucket, audited in AdminAudit, and
   * only ever used after the provider already took the money; every amount
   * here is transcribed by the operator from the real Stripe invoice, never
   * guessed or defaulted from env.
   *
   * It goes through applyMembershipEvent, the exact function the Stripe/RC
   * webhooks call, with a synthetic `subscription.activated` BillingEvent —
   * so the membership row, invoice row, Garage snapshot, XP award and ticket
   * backfill enqueue all happen exactly as they would for a real activation.
   * Idempotency on a replayed grant comes from the same place a replayed
   * webhook gets it: applyMembershipEvent's existing-row branch on
   * (provider, providerSubRef).
   *
   * Provider is hardcoded to 'stripe': Runbook 5 exists for the Stripe
   * "invoice.paid succeeded, membership never landed" case. Apple/RevenueCat
   * memberships are provisioned by Apple itself; there is no equivalent gap
   * to recover from here.
   *
   * Distinguishable from a genuine activation: normalize-stripe.ts never
   * sets BillingInvoice.providerTransactionRef for a Stripe invoice (that
   * field only ever carries Apple's original_transaction_id — see
   * services/billing/types.ts). This route sets it to the literal
   * 'admin-grant', so any `stripe` PremiumMembershipInvoice row with a
   * non-null providerTransactionRef is unambiguously a manual recovery,
   * visible straight off that row without cross-referencing AdminAudit.
   * The AdminAudit row remains the record of WHO granted it and WHY.
   *
   * Live-membership guard: handleActivated's `premiumMembership.create` runs
   * against the pre-existing partial unique index
   * `premium_membership_live_per_garage`, and there is NO P2002 handling
   * anywhere in the billing webhook path (deliberately not touched by this
   * change — separately tracked). Calling applyMembershipEvent for a garage
   * that already has a live membership under a DIFFERENT subscription would
   * let that unique-violation escape uncaught. So this route checks for an
   * existing live membership under a different (provider, providerSubRef)
   * BEFORE calling applyMembershipEvent, inside the same locked transaction,
   * and refuses with a clean 409 instead of a 500. A replay of the SAME
   * (provider, providerSubRef) is excluded from that check on purpose, so
   * re-running the same recovery stays idempotent.
   *
   * Cross-garage hijack guard (fix round 1, CRITICAL): handleActivated's
   * `findUnique({ provider_providerSubRef })` has no garageId check at all,
   * and its update branch never rewrites garageId either. Pasting a
   * providerSubRef that belongs to a DIFFERENT garage's membership — an
   * easy mistake copying ids out of the Stripe dashboard under incident
   * pressure — would otherwise silently advance that other member's period
   * and pricing while this route's Garage snapshot write still targets
   * input.garageId, leaving the target garage "premium" with no membership
   * row and a stranger's subscription quietly mutated. This route looks the
   * membership up by (provider, providerSubRef) BEFORE calling
   * applyMembershipEvent and refuses with 409 if it exists under a
   * different garageId.
   *
   * livemode (fix round 1, IMPORTANT): required input, not a default. There
   * is no event to read it off here — a grant is transcribed by hand from an
   * invoice the webhook never delivered — so the admin reading that real
   * Stripe invoice is the only source. (Fix round 2 gave applyMembershipEvent
   * a livemode of its own, fed by `event.livemode` through
   * normalize-stripe.ts, but that only covers invoices that arrive as events.
   * This route still writes it explicitly, which also re-asserts it on a
   * replay where the invoice row already existed.)
   *
   * The audit row (fix round 1, IMPORTANT) is written inside the SAME
   * transaction as the grant, not after it commits — recordAudit accepts a
   * Prisma.TransactionClient, so there is no reason to risk paid
   * entitlement landing with no actor/reason/row if something fails between
   * commit and an out-of-band audit insert.
   */
  app.post('/subscriptions/grant', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const input = adminSubscriptionGrantSchema.parse(request.body);

    const targetGarage = await prisma.garage.findUnique({
      where: { id: input.garageId },
      select: { id: true },
    });
    if (!targetGarage) {
      return reply.status(404).send({ error: 'NotFound', message: 'garage not found' });
    }

    const devFeeAmountCents = Math.round((input.baseAmountCents * input.devFeePercent) / 100);
    const currentPeriodStart = new Date(input.currentPeriodStart);
    const currentPeriodEnd = new Date(input.currentPeriodEnd);

    const evt: BillingEvent = {
      kind: 'subscription.activated',
      provider: 'stripe',
      providerCustomerRef: input.providerCustomerRef,
      providerSubRef: input.providerSubRef,
      garageId: input.garageId,
      tier: input.tier,
      cadence: input.cadence,
      currentPeriodStart,
      currentPeriodEnd,
      pricing: {
        baseAmountCents: input.baseAmountCents,
        devFeePercent: input.devFeePercent,
        devFeeAmountCents,
        grossAmountCents: input.baseAmountCents + devFeeAmountCents,
        currency: 'BRL',
      },
      invoice: {
        providerInvoiceRef: input.providerInvoiceRef,
        // Marker, not Apple data — see the handler doc comment above.
        providerTransactionRef: 'admin-grant',
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        paidAt: new Date(),
      },
      // Genuinely empty, not a placeholder: the operator transcribed the
      // amounts from the provider invoice, so there is no multi-line payload
      // here for the route to decompose. Add-ons are attached separately via
      // POST /admin/subscriptions/:id/addons.
      lines: [],
      addons: [],
      addonsAmountCents: 0,
    };

    let membershipId: string;
    try {
      membershipId = await prisma.$transaction(async (tx) => {
        // Canon §F8.5: hold SELECT FOR UPDATE on the Garage row before
        // calling applyMembershipEvent — same lock the webhook takes.
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${input.garageId} FOR UPDATE`;

        // Fix round 1, CRITICAL: handleActivated's lookup keys purely on
        // (provider, providerSubRef) and never checks — or rewrites —
        // garageId. Pasting a providerSubRef that already belongs to
        // ANOTHER garage's membership would otherwise silently advance that
        // victim membership's period/pricing/invoice while this route's
        // Garage snapshot write still targets input.garageId: the target
        // garage becomes "premium" with no membership row of its own, and
        // the victim's real membership is mutated out from under them. Catch
        // that here, before applyMembershipEvent ever runs.
        const existingBySubRef = await tx.premiumMembership.findUnique({
          where: {
            provider_providerSubRef: { provider: 'stripe', providerSubRef: input.providerSubRef },
          },
          select: { id: true, garageId: true },
        });
        if (existingBySubRef && existingBySubRef.garageId !== input.garageId) {
          throw new BillingActionError(
            'SubscriptionBelongsToAnotherGarage',
            `providerSubRef ${input.providerSubRef} already belongs to membership ${existingBySubRef.id} on garage ${existingBySubRef.garageId}, not ${input.garageId}; refusing to avoid mutating the wrong member's subscription`,
          );
        }

        const conflicting = await tx.premiumMembership.findFirst({
          where: {
            garageId: input.garageId,
            status: { in: [...LIVE_MEMBERSHIP_STATUSES] },
            NOT: { provider: 'stripe', providerSubRef: input.providerSubRef },
          },
          select: { id: true, status: true },
        });
        if (conflicting) {
          throw new BillingActionError(
            'GarageAlreadyPremium',
            `garage already has a live membership (${conflicting.id}, status ${conflicting.status}); cancel or expire it before granting a new one`,
          );
        }

        await applyMembershipEvent(tx, evt);

        const membership = await tx.premiumMembership.findUniqueOrThrow({
          where: {
            provider_providerSubRef: { provider: 'stripe', providerSubRef: input.providerSubRef },
          },
          select: { id: true },
        });

        // Fix round 1, IMPORTANT: a grant has no event to read livemode off —
        // it exists precisely because the webhook never delivered one. The
        // admin reading the real Stripe invoice is the only one who knows
        // whether the underlying charge was test-mode or live, so it is a
        // required input here, not a guess or a default. Fix round 2 taught
        // applyMembershipEvent to honour BillingInvoice.livemode (fed by
        // event.livemode through normalize-stripe.ts), which does NOT cover
        // this route; this explicit write also re-asserts the value on a
        // replay where the invoice row already existed and the insert above
        // was a no-op. Written inside this same transaction.
        await tx.premiumMembershipInvoice.update({
          where: {
            provider_providerInvoiceRef: {
              provider: 'stripe',
              providerInvoiceRef: input.providerInvoiceRef,
            },
          },
          data: { livemode: input.livemode },
        });

        // Fix round 1, IMPORTANT: recordAudit used to run after this
        // transaction committed. A crash or DB error in the gap between
        // commit and the audit insert would leave paid entitlement granted
        // with no actor, no reason and no row. recordAudit accepts a
        // Prisma.TransactionClient, so there is no reason not to make the
        // audit row atomic with the grant itself.
        await recordAudit(
          {
            actorId,
            action: 'premium.subscription.granted',
            entityType: 'premium_membership',
            entityId: membership.id,
            metadata: {
              garageId: input.garageId,
              providerInvoiceRef: input.providerInvoiceRef,
              reason: input.reason,
            },
          },
          tx,
        );

        return membership.id;
      });
    } catch (err) {
      if (sendBillingError(err, reply)) return reply;
      throw err;
    }

    // Post-commit, exactly like the webhook (canon §F8.06): ticket backfill
    // must never run inside the activation transaction.
    await enqueuePremiumTicketBackfillIfActivated(prisma, evt);

    return reply.status(201).send(adminSubscriptionGrantResponseSchema.parse({ membershipId }));
  });
};
