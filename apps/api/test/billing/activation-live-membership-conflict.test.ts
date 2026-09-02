/**
 * `subscription.activated` for a garage that ALREADY holds a live membership
 * under a DIFFERENT providerSubRef.
 *
 * handleActivated reads by (provider, providerSubRef); that lookup misses, so
 * it used to fall through to a bare `create`, which hits the partial unique
 * index `premium_membership_live_per_garage` (migration 20260527094120, lines
 * 109-111) and raises P2002. Nothing in handleActivated, applyMembershipEvent
 * or the webhook route caught it, so the webhook 500'd: Stripe took the money,
 * no membership row landed, no refund was issued, and every Stripe retry hit
 * the same violation.
 *
 * Chosen behaviour (see the comment on the guard in apply-membership-event.ts):
 * the incumbent live membership wins, the activation writes nothing, and a
 * Sentry `error` carries the garage, both subscription refs, both providers and
 * both amounts so a human can refund/cancel the duplicate.
 *
 * The guard is scoped to LIVE_PER_GARAGE_INDEX_STATUSES, which is NOT the same
 * list as LIVE_MEMBERSHIP_STATUSES. Half the tests below exist to pin that
 * difference: refusing more than the index refuses is not a safer guard, it is
 * a new way to charge a member and provision nothing.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => {
  const noop = () => {};
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: (
      cb: (scope: {
        setTag: typeof noop;
        setLevel: typeof noop;
        setExtras: typeof noop;
        setExtra: typeof noop;
        setContext: typeof noop;
      }) => void,
    ) => cb({ setTag: noop, setLevel: noop, setExtras: noop, setExtra: noop, setContext: noop }),
  };
});

const Sentry = (await import('@sentry/node')) as unknown as {
  captureMessage: ReturnType<typeof vi.fn>;
};

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const BASE_PRICING = {
  baseAmountCents: 2990,
  devFeePercent: 10,
  devFeeAmountCents: 299,
  grossAmountCents: 3289,
  currency: 'BRL',
};

const buildActivatedEvt = (
  gid: string,
  providerSubRef: string,
  providerInvoiceRef: string,
  overrides: Partial<Extract<BillingEvent, { kind: 'subscription.activated' }>> = {},
): Extract<BillingEvent, { kind: 'subscription.activated' }> => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_conflict',
  providerSubRef,
  garageId: gid,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date('2026-06-01'),
  currentPeriodEnd: new Date('2026-07-01'),
  pricing: BASE_PRICING,
  invoice: {
    providerInvoiceRef,
    periodStart: new Date('2026-06-01'),
    periodEnd: new Date('2026-07-01'),
    paidAt: new Date('2026-06-01'),
  },
  lines: [],
  addons: [],
  addonsAmountCents: 0,
  ...overrides,
});

const apply = async (evt: BillingEvent, gid: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });
};

// ---------------------------------------------------------------------------
// Service level
// ---------------------------------------------------------------------------

describe('applyMembershipEvent: activated onto a garage with a live membership', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    Sentry.captureMessage.mockClear();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps the incumbent, writes nothing for the new sub, and alerts Sentry', async () => {
    const { user } = await createUser({ email: 'conflict1@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await apply(buildActivatedEvt(gid, 'sub_first', 'in_first'), gid);
    const incumbent = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId: gid } });

    // A SECOND live subscription for the same garage. This threw P2002 before
    // the guard, taking the webhook 500 with it.
    await apply(
      buildActivatedEvt(gid, 'sub_second', 'in_second', {
        providerCustomerRef: 'cus_conflict_2',
        tier: 'silver',
        pricing: { ...BASE_PRICING, baseAmountCents: 9990, grossAmountCents: 10989 },
        currentPeriodEnd: new Date('2026-12-01'),
      }),
      gid,
    );

    // Incumbent survives, untouched.
    const rows = await prisma.premiumMembership.findMany({ where: { garageId: gid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(incumbent.id);
    expect(rows[0]!.providerSubRef).toBe('sub_first');
    expect(rows[0]!.tier).toBe('gold');
    expect(rows[0]!.currentPeriodEnd).toEqual(incumbent.currentPeriodEnd);

    // The losing invoice is NOT filed under the incumbent membership.
    const invoices = await prisma.premiumMembershipInvoice.findMany();
    expect(invoices.map((i) => i.providerInvoiceRef)).toEqual(['in_first']);

    // Garage snapshot not moved by the loser's longer period.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).toEqual(incumbent.currentPeriodEnd);

    // Loud, and actionable: garage, both providers, both sub refs, both
    // amounts, and the invoice we deliberately did not record.
    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-live-membership-conflict',
    );
    expect(call).toBeDefined();
    const opts = call![1] as { level: string; extra: Record<string, unknown> };
    expect(opts.level).toBe('error');
    expect(opts.extra).toMatchObject({
      garageId: gid,
      incumbentMembershipId: incumbent.id,
      incumbentProvider: 'stripe',
      incumbentProviderSubRef: 'sub_first',
      incumbentGrossAmountCents: 3289,
      incomingProvider: 'stripe',
      incomingProviderSubRef: 'sub_second',
      incomingProviderCustomerRef: 'cus_conflict_2',
      incomingGrossAmountCents: 10989,
      unrecordedProviderInvoiceRef: 'in_second',
    });
  });

  it('carries everything Runbook 5 needs to hand-write the row', async () => {
    // There is no admin endpoint that creates a membership. Runbook 5 says a
    // developer writes the PremiumMembership + PremiumMembershipInvoice rows by
    // hand, matching tier, cadence, baseAmountCents, devFeePercent and the
    // period bounds to the provider invoice. If the alert does not carry those,
    // the documented remediation is not executable from the alert and the
    // operator is guessing. PR #43 adds POST /admin/subscriptions/grant; until
    // it merges, this payload IS the remediation input.
    const { user } = await createUser({ email: 'conflict-runbook@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await apply(buildActivatedEvt(gid, 'sub_rb_first', 'in_rb_first'), gid);
    await apply(
      buildActivatedEvt(gid, 'sub_rb_second', 'in_rb_second', {
        tier: 'silver',
        cadence: 'annual',
        currentPeriodStart: new Date('2026-08-01'),
        currentPeriodEnd: new Date('2027-08-01'),
        invoice: {
          providerInvoiceRef: 'in_rb_second',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2027-08-01'),
          paidAt: new Date('2026-08-01T12:00:00.000Z'),
        },
      }),
      gid,
    );

    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-live-membership-conflict',
    );
    expect(call).toBeDefined();
    expect((call![1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      garageId: gid,
      incomingTier: 'silver',
      incomingCadence: 'annual',
      incomingBaseAmountCents: 2990,
      incomingDevFeePercent: 10,
      incomingCurrency: 'BRL',
      incomingCurrentPeriodStart: new Date('2026-08-01').toISOString(),
      incomingCurrentPeriodEnd: new Date('2027-08-01').toISOString(),
      unrecordedProviderInvoiceRef: 'in_rb_second',
      unrecordedPeriodStart: new Date('2026-08-01').toISOString(),
      unrecordedPeriodEnd: new Date('2027-08-01').toISOString(),
      unrecordedPaidAt: new Date('2026-08-01T12:00:00.000Z').toISOString(),
    });
  });

  it('says the member was charged', async () => {
    const { user } = await createUser({ email: 'conflict-charged@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await apply(buildActivatedEvt(gid, 'sub_ch_first', 'in_ch_first'), gid);
    await apply(buildActivatedEvt(gid, 'sub_ch_second', 'in_ch_second'), gid);

    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-live-membership-conflict',
    );
    expect(call![0]).toContain('member WAS charged');
    expect((call![1] as { extra: Record<string, unknown> }).extra.memberWasCharged).toBe(true);
  });

  it('settles the originating attempt to failed instead of leaving it to the reaper', async () => {
    // The attempt row is the only customer-visible signal on this path. Left
    // `pending`, it blocks any retry behind `SubscriptionAttemptInFlight` until
    // reapAbandonedAttempts flips it to `abandoned` hours later — a state that
    // claims the member gave up while their card was charged.
    const { user } = await createUser({ email: 'conflict-attempt@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await apply(buildActivatedEvt(gid, 'sub_at_first', 'in_at_first'), gid);

    const attempt = await prisma.premiumSubscriptionAttempt.create({
      data: {
        garageId: gid,
        cadence: 'monthly',
        planTier: 'gold',
        packageDigest: 'digestconflict',
        idempotencyKey: 'sub_at_second_key',
        providerSubRef: 'sub_at_second',
        status: 'pending',
      },
    });

    await apply(buildActivatedEvt(gid, 'sub_at_second', 'in_at_second'), gid);

    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('failed');

    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-live-membership-conflict',
    );
    expect((call![1] as { extra: Record<string, unknown> }).extra.settledAttempts).toBe(1);
  });

  it('still creates the membership when the only other row is not live', async () => {
    const { user } = await createUser({ email: 'conflict2@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await apply(buildActivatedEvt(gid, 'sub_old', 'in_old'), gid);
    await prisma.premiumMembership.updateMany({
      where: { garageId: gid },
      data: { status: 'expired' },
    });

    // Re-subscribe after the old one expired: canon says fresh row insert.
    await apply(buildActivatedEvt(gid, 'sub_new', 'in_new'), gid);

    const rows = await prisma.premiumMembership.findMany({ where: { garageId: gid } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'active').map((r) => r.providerSubRef)).toEqual([
      'sub_new',
    ]);
    expect(
      Sentry.captureMessage.mock.calls.filter(
        (c: unknown[]) =>
          (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
          'premium-live-membership-conflict',
      ),
    ).toHaveLength(0);
  });

  // The guard must be exactly as wide as the index, never wider. `paused` and
  // `trialing` are inside LIVE_MEMBERSHIP_STATUSES but outside the partial
  // unique, so Postgres accepts a second row alongside them. A guard scoped to
  // the wider list would refuse a paid activation the DB would have taken —
  // a member with a paused Stripe subscription buys on Apple, gets charged, and
  // receives nothing. That is the failure this whole file exists to prevent,
  // reintroduced by the fix for it.
  it.each(['paused', 'trialing'] as const)(
    'still creates the membership when the other row is only %s (outside the index)',
    async (status) => {
      const { user } = await createUser({
        email: `conflict-${status}@jdm.test`,
        verified: true,
      });
      const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

      await apply(buildActivatedEvt(gid, `sub_${status}_stripe`, `in_${status}_stripe`), gid);
      await prisma.premiumMembership.updateMany({ where: { garageId: gid }, data: { status } });

      // Apple purchase by the same member. Postgres accepts this insert.
      await apply(
        buildActivatedEvt(gid, `sub_${status}_apple`, `in_${status}_apple`, {
          provider: 'apple_revenuecat',
          providerCustomerRef: gid,
        }),
        gid,
      );

      const rows = await prisma.premiumMembership.findMany({ where: { garageId: gid } });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'active').map((r) => r.providerSubRef)).toEqual([
        `sub_${status}_apple`,
      ]);
      expect(
        Sentry.captureMessage.mock.calls.filter(
          (c: unknown[]) =>
            (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
            'premium-live-membership-conflict',
        ),
      ).toHaveLength(0);
    },
  );

  // The third door: an activation whose row ALREADY exists but is not live.
  // normalize-revenuecat keys providerSubRef on `original_transaction_id`,
  // which Apple reuses across re-purchases, so an Apple re-subscribe after
  // expiry arrives as INITIAL_PURCHASE onto the SAME, expired row. The
  // `existing` branches write status 'active', which moves that row into the
  // index — the same uncaught P2002 as the create, through a different door.
  it('refuses when the incoming subscription has a non-live row and another is live', async () => {
    const { user } = await createUser({ email: 'conflict-reentry@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    // Apple membership that expired.
    const appleRow = await prisma.premiumMembership.create({
      data: {
        garageId: gid,
        provider: 'apple_revenuecat',
        providerCustomerRef: gid,
        providerSubRef: 'orig_txn_reentry',
        tier: 'gold',
        cadence: 'monthly',
        status: 'expired',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        cancelAtPeriodEnd: false,
        baseAmountCents: 2990,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        grossAmountCents: 2990,
        currency: 'BRL',
      },
    });

    // Meanwhile the member went to Stripe and that one is live.
    await apply(buildActivatedEvt(gid, 'sub_reentry_stripe', 'in_reentry_stripe'), gid);

    // Apple re-purchase. Same original_transaction_id, so the same row.
    await apply(
      buildActivatedEvt(gid, 'orig_txn_reentry', 'in_reentry_apple', {
        provider: 'apple_revenuecat',
        providerCustomerRef: gid,
        currentPeriodEnd: new Date('2026-12-01'),
      }),
      gid,
    );

    // Apple row untouched, still outside the index.
    const apple = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: appleRow.id } });
    expect(apple.status).toBe('expired');
    expect(apple.currentPeriodEnd).toEqual(new Date('2026-02-01'));

    const stripeRow = await prisma.premiumMembership.findFirstOrThrow({
      where: { garageId: gid, providerSubRef: 'sub_reentry_stripe' },
    });
    expect(stripeRow.status).toBe('active');

    const invoices = await prisma.premiumMembershipInvoice.findMany();
    expect(invoices.map((i) => i.providerInvoiceRef)).toEqual(['in_reentry_stripe']);

    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-live-membership-conflict',
    );
    expect(call).toBeDefined();
    expect((call![1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      incumbentProviderSubRef: 'sub_reentry_stripe',
      incomingProviderSubRef: 'orig_txn_reentry',
      // Non-null: this is the re-purchase-onto-an-existing-row shape, not the
      // plain create.
      incomingMembershipId: appleRow.id,
      incomingMembershipStatus: 'expired',
    });
  });

  // An activation onto a row that is itself already inside the index is not a
  // conflict with anything: the index guarantees no other row is live while it
  // is. A guard that ignored `id: { not: existing.id }` would refuse every
  // ordinary activation replay.
  it('does not refuse an activation replay onto the garage own live row', async () => {
    const { user } = await createUser({ email: 'conflict-replay@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await apply(buildActivatedEvt(gid, 'sub_replay', 'in_replay'), gid);
    await apply(
      buildActivatedEvt(gid, 'sub_replay', 'in_replay_2', {
        currentPeriodEnd: new Date('2026-08-01'),
      }),
      gid,
    );

    const rows = await prisma.premiumMembership.findMany({ where: { garageId: gid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentPeriodEnd).toEqual(new Date('2026-08-01'));
    expect(
      Sentry.captureMessage.mock.calls.filter(
        (c: unknown[]) =>
          (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
          'premium-live-membership-conflict',
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route level — the money-taken-nothing-delivered 5xx
// ---------------------------------------------------------------------------

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const invoicePaidEvent = (
  eventId: string,
  invoiceId: string,
  subscriptionId: string,
  billingReason: 'subscription_create' | 'subscription_cycle' = 'subscription_create',
): WebhookEvent => ({
  id: eventId,
  type: 'invoice.paid',
  data: {
    object: {
      id: invoiceId,
      subscription: subscriptionId,
      customer: 'cus_conflict_route',
      billing_reason: billingReason,
      amount_paid: 4990,
      currency: 'brl',
      period_start: 1748300000,
      period_end: 1750892000,
      status_transitions: { paid_at: 1748300100 },
      lines: {
        data: [
          {
            price: {
              id: 'price_monthly_conflict',
              metadata: { baseAmountCents: '4536', devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    },
  },
});

describe('POST /webhooks/stripe-billing: activation onto a garage already live', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  const originalSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;

  beforeEach(async () => {
    await resetDatabase();
    Sentry.captureMessage.mockClear();

    await prisma.premiumAddonModule.deleteMany();
    await prisma.premiumPlanPrice.deleteMany();
    await prisma.premiumPlan.deleteMany();
    const plan = await prisma.premiumPlan.create({
      data: { tier: 'gold', slug: 'fundador', name: 'Fundador', active: true, sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: plan.id,
        cadence: 'monthly',
        baseAmountCents: 4536,
        currency: 'BRL',
        stripePriceId: 'price_monthly_conflict',
        active: true,
      },
    });

    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test_billing_webhook_secret_32chars';
    stripe = buildFakeStripe();
    app = await buildApp(loadEnv(), { stripe });
  });

  afterEach(async () => {
    await app?.close();
    // resetDatabase() does NOT clear PremiumPlan/PremiumPlanPrice, so the
    // catalog seeded above outlives this file and the next file's checkout
    // route resolves `price_monthly_conflict` instead of its own env price.
    // Clean up what this describe created rather than leaving the suite's
    // correctness to file ordering.
    await prisma.premiumPlanPrice.deleteMany();
    await prisma.premiumPlan.deleteMany();
    if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
    if (originalSecret === undefined) delete process.env.STRIPE_BILLING_WEBHOOK_SECRET;
    else process.env.STRIPE_BILLING_WEBHOOK_SECRET = originalSecret;
  });

  it('answers 200 and marks the event processed instead of 5xx-ing forever', async () => {
    const { user } = await createUser({ email: 'conflict3@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;
    stripe.customers.set('cus_conflict_route', { garageId: gid });

    // Garage already pays through sub_route_first.
    await apply(buildActivatedEvt(gid, 'sub_route_first', 'in_route_first'), gid);

    // A second subscription's invoice.paid lands. Before the guard this
    // returned 500 and Stripe retried it forever.
    stripe.nextEvent = invoicePaidEvent('evt_conflict_1', 'in_route_second', 'sub_route_second');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_conflict_1' },
    });
    expect(row.processedAt).not.toBeNull();

    expect(await prisma.premiumMembership.count({ where: { garageId: gid } })).toBe(1);
    expect(
      Sentry.captureMessage.mock.calls.filter(
        (c: unknown[]) =>
          (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
          'premium-live-membership-conflict',
      ),
    ).toHaveLength(1);

    // A refused activation wrote no membership, no invoice and no Garage
    // snapshot. Scheduling a ticket backfill off it is work queued by a no-op.
    expect(await prisma.premiumTicketBackfillJob.count()).toBe(0);
  });

  // The refused subscription is still live at Stripe and still billing. Its
  // next renewal lands on the unknown-subscription branch, which used to be a
  // bare log.warn: the duplicate could bill for months with nothing in Sentry.
  it('alerts Sentry when a renewal arrives for a subscription we never wrote', async () => {
    const { user } = await createUser({ email: 'conflict4@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;
    stripe.customers.set('cus_conflict_route', { garageId: gid });

    stripe.nextEvent = invoicePaidEvent(
      'evt_unknown_renewal',
      'in_unknown_renewal',
      'sub_never_written',
      'subscription_cycle',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_unknown_renewal' },
    });
    expect(row.processedAt).not.toBeNull();

    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-unknown-subscription',
    );
    expect(call).toBeDefined();
    const opts = call![1] as { level: string; extra: Record<string, unknown> };
    // A renewal moved money. Errors page; warnings do not.
    expect(opts.level).toBe('error');
    expect(opts.extra).toMatchObject({
      providerSubRef: 'sub_never_written',
      eventKind: 'subscription.renewed',
      memberWasCharged: true,
    });
  });
});

// ---------------------------------------------------------------------------
// RevenueCat — the same 5xx loop, through the door Stripe already had closed
// ---------------------------------------------------------------------------

/**
 * Refusing the duplicate does not stop the provider billing it. On Apple the
 * refused subscription renews, arrives as RENEWAL for a providerSubRef we
 * deliberately never wrote, and handleRenewed's `findUniqueOrThrow` raises
 * P2025. That escaped the transaction, the route answered 500, and RC retried
 * forever — the exact infinite loop the guard exists to remove, relocated
 * rather than fixed. Stripe already had an unknown-subscription branch; RC did
 * not.
 */
describe('POST /webhooks/revenuecat: event for a subscription we never wrote', () => {
  const RC_AUTH = 'Bearer test-rc-secret-conflict';
  let app: FastifyInstance;
  let originalAuth: string | undefined;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    Sentry.captureMessage.mockClear();
    originalAuth = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = RC_AUTH;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    app = await makeApp();
  });

  afterEach(async () => {
    await app?.close();
    if (originalAuth === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    else process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = originalAuth;
    if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  });

  const postRC = (body: unknown) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/revenuecat',
      headers: { 'content-type': 'application/json', authorization: RC_AUTH },
      payload: JSON.stringify(body),
    });

  const rcEvent = (type: string, id: string, garageId: string, origTxn: string) => ({
    event: {
      type,
      id,
      app_user_id: garageId,
      product_id: 'premium_gold_monthly',
      country_code: 'BR',
      event_timestamp_ms: Date.now(),
      transaction_id: `txn_${id}`,
      original_transaction_id: origTxn,
      expiration_at_ms: Date.now() + 30 * 24 * 3600_000,
      period_type: 'NORMAL',
      price_in_purchased_currency: 29.9,
      currency: 'BRL',
      purchased_at_ms: Date.now(),
    },
  });

  it('answers 200 and alerts on a RENEWAL, instead of 500-ing forever', async () => {
    const { user } = await createUser({ email: 'rc-unknown-renewal@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const res = await postRC(rcEvent('RENEWAL', 'rc_evt_unknown_1', gid, 'orig_txn_unknown'));

    expect(res.statusCode).toBe(200);

    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: 'rc_evt_unknown_1' },
    });
    expect(row.processedAt).not.toBeNull();
    expect(await prisma.premiumMembership.count()).toBe(0);

    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-unknown-subscription',
    );
    expect(call).toBeDefined();
    const opts = call![1] as { level: string; extra: Record<string, unknown> };
    expect(opts.level).toBe('error');
    expect(opts.extra).toMatchObject({
      providerSubRef: 'orig_txn_unknown',
      eventKind: 'subscription.renewed',
      memberWasCharged: true,
    });
  });

  it('warns rather than errors when the unknown event moved no money', async () => {
    const { user } = await createUser({ email: 'rc-unknown-expire@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const res = await postRC(rcEvent('EXPIRATION', 'rc_evt_unknown_2', gid, 'orig_txn_unknown_2'));

    expect(res.statusCode).toBe(200);
    const call = Sentry.captureMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
        'premium-unknown-subscription',
    );
    expect((call![1] as { level: string }).level).toBe('warning');
  });

  it('still applies an INITIAL_PURCHASE, which legitimately has no row yet', async () => {
    const { user } = await createUser({ email: 'rc-initial-ok@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const res = await postRC(
      rcEvent('INITIAL_PURCHASE', 'rc_evt_initial_1', gid, 'orig_txn_initial'),
    );

    expect(res.statusCode).toBe(200);
    const membership = await prisma.premiumMembership.findFirstOrThrow({
      where: { garageId: gid },
    });
    expect(membership.providerSubRef).toBe('orig_txn_initial');
    expect(membership.status).toBe('active');
  });
});
