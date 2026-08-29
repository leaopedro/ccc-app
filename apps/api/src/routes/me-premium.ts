/**
 * me-premium routes:
 *   F8.09 — POST /checkout-precheck (GET), POST /checkout, POST /billing-portal
 *   F8.11 — GET  /status
 *
 * All endpoints gate on env.GROWTH_PREMIUM_BILLING_ENABLED (canon §F8.11)
 * and return 503 ServiceUnavailable when the flag is off.
 *
 * Spec refs:
 *   §5  — precheck: 200 { available: true } or 409 AlreadySubscribed
 *   §8.2 — checkout body { cadence } + server-resolved priceId
 *   §8.3 — status response shape (premiumStatusSchema)
 */

import { createHash } from 'node:crypto';

import { prisma } from '@ccc/db';
import {
  LIVE_MEMBERSHIP_STATUSES,
  premiumBillingPortalResponseSchema,
  premiumCheckoutPrecheckResponseSchema,
  premiumCheckoutRequestSchema,
  premiumCheckoutResponseSchema,
  premiumStatusSchema,
} from '@ccc/shared/premium';
import { premiumInvoicesResponseSchema } from '@ccc/shared/premium-subscription';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import { handleStaleRef } from '../services/billing/stale-ref.js';
import { computeIsPremiumActive } from '../services/garage/index.js';
import { requireSubscriptionsEnabled } from '../services/platform-gate/guard.js';
import { enforceProfileGate } from '../services/profile/gate.js';
import type { StripeClient, SubscriptionCheckoutSessionResult } from '../services/stripe/index.js';

const billingPortalBodySchema = z.object({
  returnUrl: z.string().url().optional(),
});

/** App Store deep link to subscription management — used when the user pays via Apple IAP. */
const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Live membership statuses that block a new subscription. `expired` is
 * intentionally excluded so a lapsed user can re-subscribe.
 */
const LIVE_STATUSES = LIVE_MEMBERSHIP_STATUSES;
const ACTIVE_STATUSES = new Set<string>(LIVE_STATUSES);

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

export const mePremiumRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/me/premium/checkout-precheck
   *
   * Returns 200 { available: true } if the user can start a new subscription,
   * 409 { error: 'AlreadySubscribed', provider, manageUrl } otherwise.
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

      const liveMembership = await prisma.premiumMembership.findFirst({
        where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
        select: { provider: true, providerCustomerRef: true },
      });

      if (!liveMembership) {
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
   *      POST checkout.
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

    const parsed = premiumCheckoutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const { cadence, planSlug, addonKeys } = parsed.data;
    const selectedAddonKeys = [...new Set(addonKeys ?? [])].sort();

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
        return reply.status(404).send({ error: 'NotFound', message: 'plan not found' });
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
          ? app.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY
          : app.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
    }

    if (!priceId) {
      request.log.error(
        { cadence, tier, planSlug },
        'me-premium: checkout requested but no stripe price resolved (catalog + env)',
      );
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'billing price not configured' });
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
        return reply
          .status(400)
          .send({ error: 'BadRequest', message: 'unknown add-on key', unknownAddonKeys });
      }

      const missingAddonKeys = modules.filter((m) => !m.stripePriceId).map((m) => m.key);
      if (missingAddonKeys.length > 0) {
        request.log.error(
          { missingAddonKeys },
          'me-premium: checkout requested but add-on stripePriceId not configured',
        );
        return reply.status(503).send({
          error: 'ServiceUnavailable',
          message: 'add-on price not configured',
          missingAddonKeys,
        });
      }

      // Preserve catalog order for a stable session; the plan price stays first.
      for (const key of selectedAddonKeys) {
        const found = modules.find((m) => m.key === key);
        if (found?.stripePriceId) addonPriceIds.push(found.stripePriceId);
      }
    }

    // Inline precheck — close the race window between GET precheck + POST.
    const existingGarage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: { id: true },
    });

    if (existingGarage) {
      const liveMembership = await prisma.premiumMembership.findFirst({
        where: { garageId: existingGarage.id, status: { in: [...LIVE_STATUSES] } },
        select: { provider: true, providerCustomerRef: true },
      });

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

      const membership = await prisma.premiumMembership.findFirst({
        where: {
          garageId: garage.id,
          status: { in: [...LIVE_STATUSES] },
        },
        select: { provider: true, providerCustomerRef: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

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

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
      select: { id: true, provider: true, providerSubRef: true, currentPeriodEnd: true },
    });
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
   * garage. Reads the most-recent PremiumMembership row; falls back to the
   * canonical computeIsPremiumActive helper for admin grants on Garage when
   * no membership row exists (perpetual grants with premiumUntil=null are
   * active).
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

    // Most-recent membership row (may be expired or null). Secondary id
    // ordering keeps the pick deterministic when two rows share createdAt.
    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId: garage.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    // --- Live membership row path ---
    if (membership && ACTIVE_STATUSES.has(membership.status)) {
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
