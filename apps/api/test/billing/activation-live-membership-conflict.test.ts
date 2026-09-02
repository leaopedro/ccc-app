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
});

// ---------------------------------------------------------------------------
// Route level — the money-taken-nothing-delivered 5xx
// ---------------------------------------------------------------------------

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const invoicePaidEvent = (
  eventId: string,
  invoiceId: string,
  subscriptionId: string,
): WebhookEvent => ({
  id: eventId,
  type: 'invoice.paid',
  data: {
    object: {
      id: invoiceId,
      subscription: subscriptionId,
      customer: 'cus_conflict_route',
      billing_reason: 'subscription_create',
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
  });
});
