/**
 * me-premium routes:
 *   F8.09 — POST /checkout-precheck (GET), POST /checkout, POST /billing-portal
 *   F8.11 — GET  /status
 *
 * All endpoints gate on env.GROWTH_PREMIUM_BILLING_ENABLED (canon §F8.11)
 * and return 503 ServiceUnavailable when the flag is off.
 *
 * Spec refs:
 *   §5  — precheck: 200 { available: true }, 409 AlreadySubscribed (live
 *         membership), or 409 SubscriptionAttemptInFlight (pending native
 *         PremiumSubscriptionAttempt, Task 10 — closes the gap where a
 *         checkout-native call is invisible to a Checkout-Session-only check)
 *   §8.2 — checkout body { cadence } + server-resolved priceId
 *   §8.3 — status response shape (premiumStatusSchema)
 */

import { createHash } from 'node:crypto';

import { prisma } from '@ccc/db';
import * as Sentry from '@sentry/node';
import {
  premiumBillingPortalResponseSchema,
  premiumCheckoutPrecheckResponseSchema,
  premiumCheckoutRejectionSchema,
  premiumCheckoutRequestSchema,
  premiumCheckoutResponseSchema,
  premiumNativeCheckoutResponseSchema,
  premiumStatusSchema,
  type PremiumCheckoutRejection,
} from '@ccc/shared/premium';
import { premiumInvoicesResponseSchema } from '@ccc/shared/premium-subscription';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import { pickLiveMembership } from '../services/billing/live-membership.js';
import { handleStaleRef } from '../services/billing/stale-ref.js';
import { computeIsPremiumActive } from '../services/garage/index.js';
import { requireSubscriptionsEnabled } from '../services/platform-gate/guard.js';
import { enforceProfileGate } from '../services/profile/gate.js';
import {
  isDefinitiveSubscriptionRejection,
  type StripeClient,
  type SubscriptionCheckoutSessionResult,
} from '../services/stripe/index.js';

const billingPortalBodySchema = z.object({
  returnUrl: z.string().url().optional(),
});

/** App Store deep link to subscription management — used when the user pays via Apple IAP. */
const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * How many times to re-mint a checkout session whose idempotency key replayed a
 * non-open session. Three covers the realistic A→B→A→B→A dance; past that the
 * handler gives up and 503s rather than looping against Stripe.
 */
const MAX_SESSION_MINT_ATTEMPTS = 3;

type MintInput = Parameters<StripeClient['createSubscriptionCheckoutSession']>[0];

/**
 * Mints a Checkout Session, re-minting under a fresh idempotency key while
 * Stripe keeps replaying a session that is not `open`. Returns null when every
 * attempt came back dead, so the caller can 503 instead of handing the member a
 * URL that cannot take a card.
 *
 * A `null` status means "provider did not say" (fakes, or a response without the
 * field) and is treated as open — refusing on unknown would break checkout for a
 * shape we have no evidence is broken.
 */
const mintSubscriptionCheckoutSession = async (
  app: FastifyInstance,
  request: FastifyRequest,
  input: MintInput,
): Promise<SubscriptionCheckoutSessionResult | null> => {
  let session = await app.stripe.createSubscriptionCheckoutSession(input);
  for (let attempt = 1; attempt < MAX_SESSION_MINT_ATTEMPTS; attempt += 1) {
    if (!session.status || session.status === 'open') return session;
    request.log.warn(
      {
        sessionId: session.id,
        status: session.status,
        idempotencyKey: input.idempotencyKey,
        attempt,
      },
      'me-premium: idempotency replay returned a non-open checkout session; re-minting',
    );
    session = await app.stripe.createSubscriptionCheckoutSession({
      ...input,
      idempotencyKey: `${input.idempotencyKey}_r${session.id.slice(-12)}`,
    });
  }
  if (!session.status || session.status === 'open') return session;
  request.log.error(
    { sessionId: session.id, status: session.status, idempotencyKey: input.idempotencyKey },
    'me-premium: every checkout session mint came back non-open; refusing to return a dead url',
  );
  return null;
};

/**
 * Decisao 2 (2026-08-29): `PremiumAddonModule` so tem `monthlyDeltaCents` e
 * uma unica `stripePriceId` — add-on e mensal por construcao. A Stripe
 * recusa uma sessao de assinatura com intervalos misturados, e ate agora
 * essa recusa vinha como 503 generico do catch de `checkoutHandler`. Um 503
 * diz "tente de novo", e tentar de novo nunca funciona: o modelo ja prova a
 * incompatibilidade sem round-trip nenhum a Stripe.
 *
 * Exportada para que a rota nativa de assinatura (Task 9, mesmo arquivo)
 * reuse este mesmo guard em vez de reimplementar a checagem — caso
 * contrario o caminho nativo aceitaria uma combinacao que o checkout
 * hospedado recusa, e a Stripe acabaria recusando-a de novo la na frente
 * como um 503, exatamente o resultado que esta decisao existe para eliminar.
 *
 * Retorna o payload de rejeicao (pronto para `reply.status(422).send(...)`)
 * quando a combinacao e invalida, ou `null` quando pode prosseguir.
 */
export const checkAnnualCadenceAddonRejection = (
  cadence: 'monthly' | 'annual',
  addonKeys: readonly string[],
): PremiumCheckoutRejection | null => {
  if (cadence !== 'annual' || addonKeys.length === 0) return null;
  return premiumCheckoutRejectionSchema.parse({
    error: 'PremiumCheckoutRejected',
    code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
    message: 'Modulos adicionais sao mensais e nao podem ser contratados no plano anual.',
    addonKeys: [...addonKeys],
  });
};

/**
 * Resolucao de tier, price e add-ons compartilhada pelo checkout hospedado e
 * pelo checkout nativo (Task 9). Extraida do antigo corpo de `checkoutHandler`
 * para que os dois caminhos apliquem exatamente a mesma validacao — do
 * contrario o caminho nativo aceitaria uma combinacao que o hospedado recusa,
 * e a Stripe recusaria de novo mais na frente como um 503.
 *
 * Devolve `null` quando ja respondeu 404, 400, 422 ou 503 por conta propria;
 * nesse caso o chamador deve apenas devolver a `reply` recebida.
 */
const resolveSubscriptionPackage = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{
  tier: 'gold' | 'silver' | 'bronze';
  cadence: 'monthly' | 'annual';
  priceId: string;
  addonPriceIds: string[];
} | null> => {
  const parsed = premiumCheckoutRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    await reply.status(422).send({
      error: 'UnprocessableEntity',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return null;
  }
  const { cadence, planSlug, addonKeys } = parsed.data;
  const selectedAddonKeys = [...new Set(addonKeys ?? [])].sort();

  const cadenceAddonRejection = checkAnnualCadenceAddonRejection(cadence, selectedAddonKeys);
  if (cadenceAddonRejection) {
    await reply.status(422).send(cadenceAddonRejection);
    return null;
  }

  // Resolve the target tier. Default 'gold' keeps the legacy single-tier
  // env flow working when no planSlug is supplied. When planSlug is given
  // we resolve the tier from the catalog (server-side; never trust a
  // client price id).
  let tier: 'gold' | 'silver' | 'bronze' = 'gold';
  if (planSlug) {
    const plan = await prisma.premiumPlan.findUnique({
      where: { slug: planSlug },
      select: { tier: true, active: true },
    });
    if (!plan || !plan.active) {
      await reply.status(404).send({ error: 'NotFound', message: 'plan not found' });
      return null;
    }
    tier = plan.tier;
  }

  // Catalog-aware price resolution (additive). Prefer the catalog's
  // stripePriceId for (tier, cadence) when configured. Fall back to the
  // legacy GOLD env price ONLY for the gold tier, so existing behavior is
  // unchanged when the catalog has no provider price wired. A non-gold tier
  // without a configured stripePriceId is 503 (we never substitute the gold
  // price for another tier).
  const catalogPrice = await prisma.premiumPlanPrice.findFirst({
    where: { plan: { tier }, cadence },
    select: { stripePriceId: true },
  });

  let priceId: string | undefined;
  if (catalogPrice?.stripePriceId) {
    priceId = catalogPrice.stripePriceId;
  } else if (tier === 'gold') {
    priceId =
      cadence === 'monthly'
        ? request.server.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY
        : request.server.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  }

  if (!priceId) {
    request.log.error(
      { cadence, tier, planSlug },
      'me-premium: checkout requested but no stripe price resolved (catalog + env)',
    );
    await reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'billing price not configured' });
    return null;
  }

  // Resolve add-on prices from the catalog. Unknown/inactive key is a client
  // error (400); a known module with no stripePriceId is an operator
  // misconfiguration (503).
  const addonPriceIds: string[] = [];
  if (selectedAddonKeys.length > 0) {
    const modules = await prisma.premiumAddonModule.findMany({
      where: { key: { in: selectedAddonKeys }, active: true },
      select: { key: true, stripePriceId: true },
    });

    const found = new Set(modules.map((m) => m.key));
    const unknownAddonKeys = selectedAddonKeys.filter((k) => !found.has(k));
    if (unknownAddonKeys.length > 0) {
      await reply
        .status(400)
        .send({ error: 'BadRequest', message: 'unknown add-on key', unknownAddonKeys });
      return null;
    }

    const missingAddonKeys = modules.filter((m) => !m.stripePriceId).map((m) => m.key);
    if (missingAddonKeys.length > 0) {
      request.log.error(
        { missingAddonKeys },
        'me-premium: checkout requested but add-on stripePriceId not configured',
      );
      await reply.status(503).send({
        error: 'ServiceUnavailable',
        message: 'add-on price not configured',
        missingAddonKeys,
      });
      return null;
    }

    // Preserve catalog order for a stable session; the plan price stays first.
    for (const key of selectedAddonKeys) {
      const foundModule = modules.find((m) => m.key === key);
      if (foundModule?.stripePriceId) addonPriceIds.push(foundModule.stripePriceId);
    }
  }

  return { tier, cadence, priceId, addonPriceIds };
};

export const mePremiumRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/me/premium/checkout-precheck
   *
   * Returns 200 { available: true } if the user can start a new subscription,
   * 409 { error: 'AlreadySubscribed', provider, manageUrl } if a live
   * PremiumMembership already covers this garage, or 409
   * { error: 'SubscriptionAttemptInFlight' } if there is no live membership
   * but a native checkout-native call (Task 9) left a `pending`
   * PremiumSubscriptionAttempt for this garage. The live-membership check
   * runs first: someone who already paid gets AlreadySubscribed, not an
   * in-flight answer, even if a pending attempt row also exists (e.g. the
   * webhook that would flip it to `succeeded` has not landed yet).
   * For Stripe members the manageUrl is a freshly-minted Billing Portal URL;
   * for Apple/RC members it is the App Store deep link.
   */
  app.get(
    '/api/me/premium/checkout-precheck',
    { preHandler: [app.authenticate, requireSubscriptionsEnabled] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);

      // Precedence: 503 (feature off) → 403 (incomplete profile) → 409
      // (already subscribed). An unavailable feature is not a profile problem.
      const gated = await enforceProfileGate(app, request, sub, reply, 'subscription');
      if (gated) return gated;

      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });
      if (!garage) {
        return reply
          .status(200)
          .send(premiumCheckoutPrecheckResponseSchema.parse({ available: true }));
      }

      const liveMembership = await pickLiveMembership(prisma, garage.id);

      if (!liveMembership) {
        // No live membership, but the native path (Task 9) may have left a
        // `pending` PremiumSubscriptionAttempt for this garage — invisible to
        // a Checkout-Session-only check, since checkout-native never creates
        // one. Without this, a user who starts a native subscription, does
        // not finish, then opens the web app would sail through this
        // precheck and mint a second, hosted subscription. Filtered on
        // status='pending' specifically: `succeeded`/`abandoned` rows must
        // NOT block, or every past subscriber (whose attempt flipped to
        // succeeded on invoice.paid) would be refused a future resubscribe.
        const pendingAttempt = await prisma.premiumSubscriptionAttempt.findFirst({
          where: { garageId: garage.id, status: 'pending' },
          select: { id: true },
        });
        if (pendingAttempt) {
          return reply.status(409).send(
            premiumCheckoutPrecheckResponseSchema.parse({
              available: false,
              error: 'SubscriptionAttemptInFlight',
            }),
          );
        }
        return reply
          .status(200)
          .send(premiumCheckoutPrecheckResponseSchema.parse({ available: true }));
      }

      let manageUrl: string;
      if (liveMembership.provider === 'stripe') {
        try {
          const portal = await app.stripe.createBillingPortalSession({
            customerId: liveMembership.providerCustomerRef,
            returnUrl: `${app.env.APP_WEB_BASE_URL}/me/billing`,
          });
          manageUrl = portal.url;
        } catch (err) {
          handleStaleRef(err, liveMembership.providerCustomerRef, 'premium_precheck');
          // premiumCheckoutPrecheckResponseSchema requires a non-null manageUrl,
          // and widening that shared contract is out of scope here. Answering
          // StaleBillingReference is still a 409 and beats both an unhandled 500
          // and promising a manage link that cannot be minted.
          return reply.status(409).send({
            error: 'StaleBillingReference',
            message: 'billing reference no longer valid',
          });
        }
      } else {
        manageUrl = APPLE_MANAGE_URL;
      }

      return reply.status(409).send(
        premiumCheckoutPrecheckResponseSchema.parse({
          available: false,
          error: 'AlreadySubscribed',
          provider: liveMembership.provider,
          manageUrl,
        }),
      );
    },
  );

  /**
   * POST /api/me/premium/checkout
   *
   * Body: { cadence: 'monthly' | 'annual' }
   *
   * Steps:
   *   1. Resolve priceId from env (server-side; never trust client price IDs).
   *   2. Re-run the precheck inline to close the race between GET precheck and
   *      POST checkout — including a check for a `pending` native
   *      PremiumSubscriptionAttempt (Task 10), which has no Checkout Session
   *      and so is otherwise invisible to step 4 below.
   *   3. findOrCreateCustomer with the user's email + garageId metadata.
   *   4. listOpenSubscriptionCheckoutSessions to close the cross-cadence dup
   *      window between session creation and webhook activation.
   *   5. createSubscriptionCheckoutSession in subscription mode with a stable
   *      idempotency key (checkout_sub_{garageId}_{cadence}).
   */
  const checkoutHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const { sub } = requireUser(request);

    // Repeated here on purpose. The precheck is advisory; the window between
    // GET and POST is the same one the AlreadySubscribed check below closes.
    const gated = await enforceProfileGate(app, request, sub, reply, 'subscription');
    if (gated) return gated;

    const pkg = await resolveSubscriptionPackage(request, reply);
    if (!pkg) return reply; // resolveSubscriptionPackage ja respondeu
    const { cadence, priceId, addonPriceIds } = pkg;

    // Inline precheck — close the race window between GET precheck + POST.
    const existingGarage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: { id: true },
    });

    if (existingGarage) {
      const liveMembership = await pickLiveMembership(prisma, existingGarage.id);

      if (liveMembership) {
        let manageUrl: string;
        if (liveMembership.provider === 'stripe') {
          try {
            const portal = await app.stripe.createBillingPortalSession({
              customerId: liveMembership.providerCustomerRef,
              returnUrl: `${app.env.APP_WEB_BASE_URL}/me/billing`,
            });
            manageUrl = portal.url;
          } catch (err) {
            handleStaleRef(err, liveMembership.providerCustomerRef, 'premium_checkout_precheck');
            return reply.status(409).send({
              error: 'StaleBillingReference',
              message: 'billing reference no longer valid',
            });
          }
        } else {
          manageUrl = APPLE_MANAGE_URL;
        }
        return reply.status(409).send(
          premiumCheckoutPrecheckResponseSchema.parse({
            available: false,
            error: 'AlreadySubscribed',
            provider: liveMembership.provider,
            manageUrl,
          }),
        );
      }

      // No live membership, but a native checkout-native call (Task 9) may
      // have left a `pending` PremiumSubscriptionAttempt for this garage —
      // invisible to listOpenSubscriptionCheckoutSessions below, since
      // checkout-native never creates a Checkout Session. Block unconditionally
      // here regardless of whether `pending.cadence`/`packageDigest` match this
      // request's resolved package: unlike checkout-native's own same-package
      // reuse (which collapses onto the SAME Stripe subscription via a shared
      // idempotency key derived from attempt.id), this hosted path always mints
      // a brand-new Checkout Session/subscription with no link back to that
      // attempt — so even a same-package retry here would create a second live
      // subscription alongside the native one. Filtered on status='pending'
      // specifically: a `succeeded`/`abandoned` row must NOT block, or every
      // past subscriber would be refused a future resubscribe.
      const pendingAttempt = await prisma.premiumSubscriptionAttempt.findFirst({
        where: { garageId: existingGarage.id, status: 'pending' },
        select: { id: true },
      });
      if (pendingAttempt) {
        return reply.status(409).send(
          premiumCheckoutPrecheckResponseSchema.parse({
            available: false,
            error: 'SubscriptionAttemptInFlight',
          }),
        );
      }
    }

    const user = await prisma.user.findUnique({ where: { id: sub }, select: { email: true } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const garage =
      existingGarage ??
      (await prisma.garage.upsert({
        where: { userId: sub },
        create: { userId: sub, name: 'Garagem', slug: `garage-${sub}` },
        update: {},
        select: { id: true },
      }));

    const { customerId } = await app.stripe.findOrCreateCustomer({
      email: user.email,
      garageId: garage.id,
    });

    // A stale open session holds the previous package. Expire it so the member
    // is not pushed back into a selection they abandoned. This is best-effort
    // housekeeping, not a precondition for minting a new session: Stripe 400s
    // (invalid_request) if the session already closed between our list call
    // and this expire (e.g. the member paid in another tab), and any outage
    // here must not block a member who otherwise has a valid checkout ahead
    // of them. Swallow and log per session instead of letting it escape to a
    // raw 500.
    const openSessions = await app.stripe.listOpenSubscriptionCheckoutSessions(customerId);
    for (const open of openSessions) {
      try {
        await app.stripe.expireCheckoutSession(open.id);
      } catch (err) {
        request.log.warn(
          { err, sessionId: open.id },
          'me-premium: failed to expire a stale checkout session; continuing anyway',
        );
      }
    }

    // The key must cover the RESOLVED line items, not the client-supplied
    // selection: an operator rotating a catalog/env stripePriceId between two
    // attempts by the same garage inside Stripe's 24h idempotency window (or,
    // with no planSlug, the non-deterministic findFirst plan-price lookup
    // above resolving a different row) must mint a genuinely new session, not
    // replay a stale one — and must never let Stripe's 400 idempotency_error
    // (same key, different params) surface as a 503 to a member who did
    // nothing wrong.
    const packageDigest = createHash('sha1')
      .update([priceId, ...addonPriceIds].join('|'))
      .digest('hex')
      .slice(0, 12);
    const idempotencyKey = `checkout_sub_${garage.id}_${cadence}_${packageDigest}`;

    // R1: a multi-line subscription session requires every price to share the
    // same interval and currency. Stripe rejects the mix, and that is an
    // operator catalog problem, not a client error — surface it as 503.
    //
    // The mint is a bounded loop, not a single call, because the idempotency key
    // above collides with the expire sweep. Stripe replays the STORED response
    // for a key used in the last 24h, and the stored session may be one this
    // very handler expired: member asks for package A, wanders off, asks for
    // package B (which expires A), then comes back to A. The package digest is
    // unchanged, so Stripe hands back A — now dead — and the member lands on
    // Stripe's "You're all done here" page behind a 201, with no error logged
    // anywhere and no way out for up to 24h.
    //
    // Deriving the retry key from the dead session id keeps the double-click
    // dedup that the key exists for (two rapid identical requests still collapse
    // onto the same replay, dead or alive) while guaranteeing a key Stripe has
    // never seen. Each iteration burns a distinct dead id, so the loop converges
    // even when a longer A→B→A→B→A dance poisoned more than one key.
    let session;
    try {
      session = await mintSubscriptionCheckoutSession(app, request, {
        customerId,
        priceIds: [priceId, ...addonPriceIds],
        successUrl: `${app.env.APP_WEB_BASE_URL}/assinaturas/checkout-return`,
        cancelUrl: `${app.env.APP_WEB_BASE_URL}/assinaturas`,
        metadata: { garageId: garage.id, userId: sub, cadence },
        idempotencyKey,
      });
    } catch (err) {
      request.log.error(
        { err, priceIds: [priceId, ...addonPriceIds] },
        'me-premium: stripe rejected the subscription checkout session',
      );
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
    }

    // Every attempt came back dead. Answering 503 is worse for the member than a
    // working checkout and better than a 201 pointing at a page that cannot take
    // a card: the client already has a retry affordance for 503.
    if (session === null) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
    }

    return reply
      .status(201)
      .send(premiumCheckoutResponseSchema.parse({ url: session.url, sessionId: session.id }));
  };

  /**
   * POST /api/me/premium/checkout-native
   *
   * Assinatura para o PaymentSheet. Guarda de duplicidade da Decisao 4, cinco
   * pecas:
   *
   *  1. SELECT ... FOR UPDATE na linha de Garage antes de qualquer
   *     subscriptions.create. Mesmo padrao de stripe-billing-webhook.ts:754.
   *     Dois toques concorrentes serializam.
   *  2. PremiumSubscriptionAttempt com unique parcial por garageId onde
   *     status = 'pending'. E o registro pre-pagamento. PremiumMembership fica
   *     intocada, o que PRESERVA a invariante de que membership so nasce de
   *     webhook verificado.
   *  3. Chave determinstica sub_${garageId}_${cadence}_${digest}_${attemptId}.
   *     Toques concorrentes caem na mesma tentativa e colapsam numa assinatura
   *     so. Recontratar depois de cancelar abre tentativa nova, e portanto
   *     assinatura nova, sem colisao de chave.
   *  4. Reaping por TTL de 23h no worker de reconciliacao (task separada), antes
   *     de a Stripe transicionar para incomplete_expired.
   *  5. (Task 10, espelho do guard cross-path do checkout hospedado)
   *     listOpenSubscriptionCheckoutSessions apos a transacao: recusa em vez
   *     de mintar quando ha uma Checkout Session hospedada aberta para esta
   *     garagem, senao o caminho nativo fica cego para um checkout hospedado
   *     ja em andamento e mintaria uma segunda assinatura viva.
   */
  const nativeCheckoutHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const { sub } = requireUser(request);

    const gated = await enforceProfileGate(app, request, sub, reply, 'subscription');
    if (gated) return gated;

    const pkg = await resolveSubscriptionPackage(request, reply);
    if (!pkg) return reply; // resolveSubscriptionPackage ja respondeu

    const user = await prisma.user.findUnique({ where: { id: sub }, select: { email: true } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const garage = await prisma.garage.upsert({
      where: { userId: sub },
      create: { userId: sub, name: 'Garagem', slug: `garage-${sub}` },
      update: {},
      select: { id: true },
    });

    const { customerId } = await app.stripe.findOrCreateCustomer({
      email: user.email,
      garageId: garage.id,
    });

    const packageDigest = createHash('sha1')
      .update([pkg.priceId, ...pkg.addonPriceIds].join('|'))
      .digest('hex')
      .slice(0, 12);

    // Lock + precheck + tentativa numa transacao so. O lock e o que faz dois
    // toques concorrentes serializarem em vez de criarem duas assinaturas.
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garage.id} FOR UPDATE`;

      const live = await pickLiveMembership(tx, garage.id);
      if (live) return { kind: 'already' as const, live };

      // Um pending de OUTRO pacote (cadence ou packageDigest diferentes) NAO
      // pode ser reusado: a chave recalculada levaria o novo digest, a Stripe
      // trataria como chave inedita (nao colapsaria com a tentativa em voo),
      // e um segundo subscriptions.create mintaria uma SEGUNDA assinatura
      // viva para a mesma garagem enquanto a primeira ainda pode confirmar.
      // Recusar aqui, antes de qualquer chamada a Stripe, mantem valendo a
      // garantia de "no maximo uma assinatura por garagem" que a guarda
      // inteira existe para dar.
      const pending = await tx.premiumSubscriptionAttempt.findFirst({
        where: { garageId: garage.id, status: 'pending' },
      });
      if (pending) {
        if (pending.cadence === pkg.cadence && pending.packageDigest === packageDigest) {
          return { kind: 'reuse' as const, attempt: pending };
        }
        return { kind: 'conflict' as const };
      }

      const created = await tx.premiumSubscriptionAttempt.create({
        data: {
          garageId: garage.id,
          cadence: pkg.cadence,
          planTier: pkg.tier,
          packageDigest,
          idempotencyKey: '',
          status: 'pending',
        },
      });
      return { kind: 'created' as const, attempt: created };
    });

    if (outcome.kind === 'already') {
      return reply.status(409).send({
        error: 'AlreadySubscribed',
        provider: outcome.live.provider,
        message: 'ja existe assinatura viva para esta garagem',
      });
    }

    if (outcome.kind === 'conflict') {
      return reply.status(409).send({
        error: 'SubscriptionAttemptInFlight',
        message: 'ja existe uma tentativa de assinatura em andamento para outro pacote',
      });
    }

    const attempt = outcome.attempt;

    // So marca abandoned quando ESTA requisicao foi quem criou a linha
    // (outcome.kind === 'created'): ela nunca chegou na Stripe
    // (createNativeSubscription nem rodou ainda), entao nao ha nada la fora
    // para perder o rastro. Uma linha 'reuse' e anterior a esta requisicao
    // (outra tentativa nativa a criou) — nao e desta chamada para abandonar.
    const abandonIfJustCreated = async (): Promise<void> => {
      if (outcome.kind === 'created') {
        await prisma.premiumSubscriptionAttempt.update({
          where: { id: attempt.id },
          data: { status: 'abandoned' },
        });
      }
    };

    // Espelho do guard cross-path do Task 10 (que fez o hospedado enxergar a
    // tentativa nativa): aqui e o caminho nativo que precisa enxergar uma
    // Checkout Session hospedada aberta. Sem isso, um usuario que comeca um
    // checkout hospedado na web (Checkout Session aberta, nenhuma membership
    // ainda, nenhuma PremiumSubscriptionAttempt) e depois toca em assinar no
    // iOS passaria por live-membership e pending-attempt sem achar nada, e
    // este handler mintaria uma SEGUNDA assinatura viva — o mesmo buraco de
    // cobranca duplicada, so que na direcao oposta.
    //
    // Chamada de rede, portanto roda DEPOIS que a transacao acima liberou o
    // lock (mesma razao pela qual createNativeSubscription tambem fica fora
    // da transacao). Recusa em vez de mintar, sem distinguir pacote: o
    // hospedado nao tem nenhum vinculo de idempotencia com esta tentativa
    // nativa, entao mesmo um pacote identico resultaria numa segunda
    // assinatura genuinamente nova se deixassemos passar.
    //
    // try/catch explicito, NAO finally: um `finally` rodaria tambem no
    // caminho feliz (nenhuma sessao hospedada aberta), e abandonaria a
    // tentativa 'pending' bem no momento em que o codigo logo abaixo precisa
    // dela para chamar createNativeSubscription — quebraria o caminho feliz
    // inteiro. So o catch (falha ao consultar a Stripe) e o ramo "achou
    // sessao aberta" abaixo devem abandonar; o caminho sem erro e sem sessao
    // aberta nao deve tocar a linha.
    let openHostedSessions: Awaited<
      ReturnType<StripeClient['listOpenSubscriptionCheckoutSessions']>
    >;
    try {
      openHostedSessions = await app.stripe.listOpenSubscriptionCheckoutSessions(customerId);
    } catch (err) {
      // A chamada nao provou nada sobre a existencia (ou nao) de um checkout
      // hospedado aberto — mas TAMBEM nao chegamos em createNativeSubscription,
      // entao nada foi criado do lado da Stripe para esta tentativa. Falhar
      // fechado (nao mintar) esta certo; o que nao pode acontecer e deixar a
      // linha 'pending' orfa so porque a falha aconteceu ANTES do ramo que já
      // sabia limpar (o "achou sessao aberta" abaixo) — mesmo unique parcial
      // por garageId WHERE status='pending' bloquearia essa garagem ate o
      // reaper de 23h por causa de uma falha de rede que nem chegou a provar
      // duplicidade nenhuma.
      await abandonIfJustCreated();
      request.log.error(
        { err, garageId: garage.id, attemptId: attempt.id },
        'me-premium: falha ao consultar checkout hospedado aberto; assinatura nativa recusada',
      );
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
    }
    if (openHostedSessions.length > 0) {
      // outcome.kind === 'reuse': a linha pending e anterior a esta
      // requisicao (outra tentativa nativa a criou) — deixa-la como estava.
      await abandonIfJustCreated();
      request.log.warn(
        { garageId: garage.id, openSessionIds: openHostedSessions.map((s) => s.id) },
        'me-premium: assinatura nativa recusada, checkout hospedado ja em andamento',
      );
      return reply.status(409).send({
        error: 'SubscriptionAttemptInFlight',
        message: 'ja existe um checkout hospedado em andamento para esta garagem',
      });
    }

    // Chave derivada de attempt.id, nao de um valor aleatorio por toque: um
    // segundo toque que reutiliza a MESMA tentativa 'pending' (outcome.kind
    // === 'reuse') recalcula a MESMA chave, e e a Stripe — nao este handler —
    // quem colapsa a segunda chamada na resposta ja processada da primeira.
    const idempotencyKey = `sub_${garage.id}_${pkg.cadence}_${packageDigest}_${attempt.id}`;

    let result;
    try {
      result = await app.stripe.createNativeSubscription({
        customerId,
        priceIds: [pkg.priceId, ...pkg.addonPriceIds],
        metadata: { garageId: garage.id, userId: sub, cadence: pkg.cadence },
        idempotencyKey,
      });
    } catch (err) {
      // So marca abandoned quando a Stripe PROVA que recusou o pedido sem
      // criar nada (isDefinitiveSubscriptionRejection). Um idempotency_error
      // (a chamada perdedora de duas concorrentes com a MESMA chave, presa
      // atras da primeira ainda em voo), um erro de conexao/timeout, ou um
      // 5xx da Stripe NAO provam isso — a assinatura pode ter sido criada do
      // lado da Stripe. Marcar abandoned nesses casos apagaria o rastro
      // (providerSubRef) de uma assinatura que pode estar viva e cobrando, e
      // abriria espaco para uma segunda tentativa mintar uma SEGUNDA
      // assinatura. Deixar 'pending' e o resultado seguro; TTL/reconciliacao
      // (task separada) resolve o caso raro em que a Stripe de fato nao
      // criou nada.
      if (isDefinitiveSubscriptionRejection(err)) {
        await prisma.premiumSubscriptionAttempt.update({
          where: { id: attempt.id },
          data: { status: 'abandoned' },
        });
      } else {
        request.log.warn(
          { err, garageId: garage.id, attemptId: attempt.id },
          'me-premium: assinatura nativa falhou de forma ambigua; tentativa permanece pending',
        );
      }
      request.log.error(
        { err, garageId: garage.id },
        'me-premium: stripe recusou a assinatura nativa',
      );
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
    }

    if (!result.clientSecret) {
      // Deixa 'pending', nao 'abandoned': result.subscriptionId prova que a
      // assinatura existe do lado da Stripe e pode cobrar mesmo sem
      // confirmation_secret nenhuma. Marcar abandoned aqui libera o indice
      // unico parcial por garageId WHERE status='pending', e um retry do
      // cliente minta uma SEGUNDA assinatura viva — as duas chegam a
      // handleActivated, onde a segunda bate um P2002 que derruba o webhook
      // de billing. Mesma logica do catch acima (isDefinitiveSubscriptionRejection):
      // o reaper de tentativa abandonada decide o caso raro que sobrar.
      await prisma.premiumSubscriptionAttempt.update({
        where: { id: attempt.id },
        data: { providerSubRef: result.subscriptionId, idempotencyKey },
      });
      request.log.error(
        { garageId: garage.id, subscriptionId: result.subscriptionId, status: result.status },
        'me-premium: assinatura nativa sem confirmation_secret',
      );
      Sentry.captureMessage('me-premium: assinatura nativa sem confirmation_secret', {
        level: 'error',
        tags: { kind: 'premium-native-subscription-no-secret', provider: 'stripe' },
        extra: { subscriptionId: result.subscriptionId, status: result.status },
      });
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
    }

    await prisma.premiumSubscriptionAttempt.update({
      where: { id: attempt.id },
      data: { providerSubRef: result.subscriptionId, idempotencyKey },
    });

    return reply.status(201).send(
      premiumNativeCheckoutResponseSchema.parse({
        subscriptionId: result.subscriptionId,
        clientSecret: result.clientSecret,
        attemptId: attempt.id,
      }),
    );
  };

  /**
   * POST /api/me/premium/billing-portal
   *
   * Body: { returnUrl?: string } — origin-pinned against APP_WEB_BASE_URL.
   *
   * Returns a Stripe Billing Portal URL for the current user's Stripe
   * subscription. For Apple/RC members, returns 409 NotStripeSubscription with
   * the App Store deep link (no Stripe portal available).
   */
  app.post(
    '/api/me/premium/billing-portal',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);

      const parsedBody = billingPortalBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          issues: parsedBody.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const defaultReturnUrl = `${app.env.APP_WEB_BASE_URL}/me/billing`;
      const candidate = parsedBody.data.returnUrl;
      const returnUrl =
        candidate && candidate.startsWith(`${app.env.APP_WEB_BASE_URL}/`)
          ? candidate
          : defaultReturnUrl;

      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });
      if (!garage) {
        return reply.status(404).send({ error: 'NotFound', message: 'no membership found' });
      }

      const membership = await pickLiveMembership(prisma, garage.id);

      if (!membership) {
        return reply.status(404).send({ error: 'NotFound', message: 'no active membership found' });
      }

      if (membership.provider !== 'stripe') {
        return reply.status(409).send({
          error: 'NotStripeSubscription',
          message: 'manage your subscription in the App Store',
          manageUrl: APPLE_MANAGE_URL,
        });
      }

      let portal;
      try {
        portal = await app.stripe.createBillingPortalSession({
          customerId: membership.providerCustomerRef,
          returnUrl,
        });
      } catch (err) {
        handleStaleRef(err, membership.providerCustomerRef, 'premium_billing_portal');
        return reply.status(409).send({
          error: 'StaleBillingReference',
          message: 'billing reference no longer valid',
        });
      }

      return reply.status(200).send(premiumBillingPortalResponseSchema.parse(portal));
    },
  );

  /**
   * POST /api/me/premium/cancel
   *
   * Schedules cancellation at period end on Stripe and returns immediately.
   * Deliberately does NOT touch the DB: the resulting
   * customer.subscription.updated webhook normalizes to subscription.cancelled
   * and handleCancelled writes the row. Keeps the invariant that subscription
   * state only changes through a verified webhook.
   */
  const cancelHandler = async (request: FastifyRequest, reply: FastifyReply) => {
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
      return reply.status(404).send({ error: 'NotFound', message: 'no live membership' });
    }

    // Same pick as GET /status, by construction: the member must cancel the
    // subscription the app just told them they have, not a trialing or paused
    // sibling that leaves the billing one alive.
    const membership = await pickLiveMembership(prisma, garage.id);
    if (!membership) {
      return reply.status(404).send({ error: 'NotFound', message: 'no live membership' });
    }

    if (membership.provider !== 'stripe') {
      return reply.status(409).send({
        error: 'NotStripeSubscription',
        provider: membership.provider,
        manageUrl: APPLE_MANAGE_URL,
      });
    }

    const result = await app.stripe.cancelSubscriptionAtPeriodEnd({
      subscriptionId: membership.providerSubRef,
      idempotencyKey: `cancel_sub_${membership.id}`,
    });

    // currentPeriodEnd comes from the DB row, not Stripe's response.
    // Scheduling a cancellation does not move the period boundary, and the
    // row is this repo's source of truth for subscription state (kept in
    // sync by the verified customer.subscription.updated webhook) — see the
    // doc comment on CancelSubscriptionAtPeriodEndResult.
    return reply.status(200).send({
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
    });
  };

  /**
   * GET /api/me/premium/invoices
   *
   * Billing history as the member sees it. Reads every membership row of the
   * user's garage (expired rows accumulate as history), newest first, capped
   * at 24. Provider refs are never serialized.
   */
  app.get(
    '/api/me/premium/invoices',
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
        return reply.status(200).send(premiumInvoicesResponseSchema.parse({ invoices: [] }));
      }

      const rows = await prisma.premiumMembershipInvoice.findMany({
        where: { membership: { garageId: garage.id } },
        orderBy: { periodStart: 'desc' },
        take: 24,
        select: {
          periodStart: true,
          periodEnd: true,
          paidAt: true,
          grossAmountCents: true,
          currency: true,
          status: true,
          refundedAt: true,
        },
      });

      return reply.status(200).send(
        premiumInvoicesResponseSchema.parse({
          invoices: rows.map((r) => ({
            periodStart: r.periodStart.toISOString(),
            periodEnd: r.periodEnd.toISOString(),
            paidAt: r.paidAt.toISOString(),
            grossAmountCents: r.grossAmountCents,
            currency: r.currency,
            status: r.status,
            refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
          })),
        }),
      );
    },
  );

  /**
   * GET /api/me/premium/status (F8.11)
   *
   * Returns the current premium entitlement state for the requesting user's
   * garage. Reads the garage's live PremiumMembership via pickLiveMembership
   * (the same pick /cancel and the checkout guards use); falls back to the
   * canonical computeIsPremiumActive helper for admin grants on Garage when
   * there is no live membership row (perpetual grants with premiumUntil=null
   * are active).
   *
   * On Stripe portal mint failure (test env without live key, network error,
   * missing Dashboard portal config), manageUrl is null + the error is logged;
   * the client treats null as "self-serve management unavailable".
   */
  app.get('/api/me/premium/status', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message: 'Premium billing is not enabled.',
      });
    }

    const { sub } = requireUser(request);

    const garage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: {
        id: true,
        premiumTier: true,
        premiumUntil: true,
      },
    });
    if (!garage) {
      return reply.status(404).send({ error: 'NotFound', message: 'Garage not found.' });
    }

    // The garage's live membership, picked by the same rule every action on
    // this file uses, so the screen and the action never describe different
    // rows. Null when the garage has none (never subscribed, or every row is
    // expired) — the admin-grant fallback below then answers.
    const membership = await pickLiveMembership(prisma, garage.id);

    // --- Live membership row path ---
    if (membership) {
      let manageUrl: string | null = null;
      if (membership.provider === 'apple_revenuecat') {
        manageUrl = APPLE_MANAGE_URL;
      } else if (membership.provider === 'stripe' && membership.providerCustomerRef) {
        try {
          const portal = await app.stripe.createBillingPortalSession({
            customerId: membership.providerCustomerRef,
            returnUrl: `${app.env.APP_WEB_BASE_URL}/me/billing`,
          });
          manageUrl = portal.url;
        } catch (err) {
          request.log.warn(
            { err, providerCustomerRef: membership.providerCustomerRef },
            'me-premium-status: failed to mint Stripe Billing Portal session',
          );
          manageUrl = null;
        }
      }
      return premiumStatusSchema.parse({
        active: true,
        tier: membership.tier,
        cadence: membership.cadence,
        provider: membership.provider,
        currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
        manageUrl,
      });
    }

    // --- Admin-grant fallback path ---
    // Canonical computeIsPremiumActive treats premiumUntil=null as perpetual.
    // currentPeriodEnd is null for perpetual; no self-serve management URL.
    if (computeIsPremiumActive(garage.premiumTier, garage.premiumUntil)) {
      return premiumStatusSchema.parse({
        active: true,
        tier: garage.premiumTier,
        cadence: null,
        provider: null,
        currentPeriodEnd: garage.premiumUntil ? garage.premiumUntil.toISOString() : null,
        cancelAtPeriodEnd: false,
        manageUrl: null,
      });
    }

    // --- Inactive / never subscribed ---
    return premiumStatusSchema.parse({
      active: false,
      tier: null,
      cadence: null,
      provider: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      manageUrl: null,
    });
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
      keyGenerator: (req) => `premium-checkout:${req.user?.sub ?? req.ip}`,
    });
    scoped.post(
      '/api/me/premium/checkout',
      { preHandler: requireSubscriptionsEnabled },
      checkoutHandler,
    );
  });

  // Limite por usuario autenticado, nao por IP. app.ts nao seta trustProxy,
  // entao atras do Railway req.ip e o proxy de borda para todo mundo e um
  // limite por IP seria um balde global. Chavear no sub evita o problema.
  // Sem limite, "UUID novo a cada toque" e torneira de assinaturas orfas.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `premium-checkout-native:${req.user?.sub ?? req.ip}`,
    });
    scoped.post(
      '/api/me/premium/checkout-native',
      { preHandler: requireSubscriptionsEnabled },
      nativeCheckoutHandler,
    );
  });

  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `premium-cancel:${req.user?.sub ?? req.ip}`,
    });
    scoped.post('/api/me/premium/cancel', cancelHandler);
  });
};
