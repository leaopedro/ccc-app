/**
 * Integration tests for POST /webhooks/stripe-billing (F8.04).
 *
 * Testcontainers Postgres via makeApp helper. No mocks for DB — real writes.
 * Stripe signature verification is exercised through FakeStripe.constructWebhookEvent
 * which honors `nextSignatureValid` + `nextEvent`, matching the pattern in
 * test/stripe/webhook.test.ts.
 *
 * Feature flag GROWTH_PREMIUM_BILLING_ENABLED is toggled via process.env BEFORE
 * makeApp() so loadEnv picks up the value at boot. We restore the original env
 * after each test.
 */

import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';
import { createUser, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const invoicePaidEvent = (
  billingReason: 'subscription_create' | 'subscription_cycle',
  eventId: string,
): WebhookEvent => ({
  id: eventId,
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_test_001',
      subscription: 'sub_test_001',
      customer: 'cus_test_001',
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
              id: 'price_monthly_test',
              metadata: { baseAmountCents: '4536', devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    },
  },
});

const subscriptionUpdatedEvent = (
  eventId: string,
  subOverride: Record<string, unknown>,
  previousAttributes: Record<string, unknown>,
): WebhookEvent => ({
  id: eventId,
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_test_001',
      customer: 'cus_test_001',
      cancel_at_period_end: false,
      current_period_start: 1748300000,
      current_period_end: 1750892000,
      canceled_at: null,
      items: {
        data: [
          {
            price: {
              id: 'price_monthly_test',
              metadata: { baseAmountCents: '4536', devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
          },
        ],
      },
      ...subOverride,
      previous_attributes: previousAttributes,
    },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an app with FakeStripe + the given feature-flag value. */
const buildBillingApp = async (
  flagEnabled: boolean,
): Promise<{ app: FastifyInstance; stripe: FakeStripe }> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = flagEnabled ? 'true' : 'false';
  process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test_billing_webhook_secret_32chars';
  const stripe = buildFakeStripe();
  const app = await buildApp(loadEnv(), { stripe });
  return { app, stripe };
};

/** Seed a user → garage and register the customer metadata in FakeStripe. */
const seedGarageWithStripeCustomer = async (
  stripe: FakeStripe,
  customerId: string,
): Promise<{ garageId: string; userId: string }> => {
  const { user } = await createUser({
    email: `f8-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    verified: true,
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  stripe.customers.set(customerId, { garageId: garage.id });
  return { garageId: garage.id, userId: user.id };
};

const seedActiveMembership = async (
  garageId: string,
  overrides: Partial<{
    status: 'active' | 'cancel_scheduled' | 'past_due' | 'expired';
    cadence: 'monthly' | 'annual';
    cancelAtPeriodEnd: boolean;
  }> = {},
): Promise<string> => {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: 'cus_test_001',
      providerSubRef: 'sub_test_001',
      tier: 'gold',
      cadence: overrides.cadence ?? 'monthly',
      status: overrides.status ?? 'active',
      currentPeriodStart: now,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      baseAmountCents: 4536,
      devFeePercent: 10,
      devFeeAmountCents: 454,
      grossAmountCents: 4990,
      currency: 'BRL',
    },
  });
  return membership.id;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/stripe-billing', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  const originalSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    if (originalFlag === undefined) {
      delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    } else {
      process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
    }
    if (originalSecret === undefined) {
      delete process.env.STRIPE_BILLING_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_BILLING_WEBHOOK_SECRET = originalSecret;
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: Feature flag disabled
  // -------------------------------------------------------------------------

  it('returns 200 and skips DB writes when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
    ({ app, stripe } = await buildBillingApp(false));
    stripe.nextEvent = invoicePaidEvent('subscription_create', 'evt_flag_disabled_1');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, skipped: true, reason: 'flag_disabled' });

    const count = await prisma.subscriptionWebhookEvent.count();
    expect(count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: Missing signature
  // -------------------------------------------------------------------------

  it('returns 400 when stripe-signature header is missing', async () => {
    ({ app } = await buildBillingApp(true));

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json' },
      payload: rawJson({}),
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatch(/missing signature/i);
  });

  // -------------------------------------------------------------------------
  // Test 2b: Misconfigured — flag enabled but STRIPE_BILLING_WEBHOOK_SECRET unset
  // Guards against the checkout-secret fallback in stripe.constructWebhookEvent
  // (`webhookSecret ?? env.STRIPE_WEBHOOK_SECRET`).
  // -------------------------------------------------------------------------

  it('returns 500 when STRIPE_BILLING_WEBHOOK_SECRET is missing while flag is enabled', async () => {
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    delete process.env.STRIPE_BILLING_WEBHOOK_SECRET;
    const stripe = buildFakeStripe();
    app = await buildApp(loadEnv(), { stripe });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'whatever' },
      payload: rawJson({ id: 'evt_test', type: 'invoice.paid' }),
    });

    expect(res.statusCode).toBe(500);
    expect(res.payload).toMatch(/billing webhook secret missing/i);
  });

  // -------------------------------------------------------------------------
  // Test 3: Invalid signature
  // -------------------------------------------------------------------------

  it('returns 400 when stripe-signature is invalid', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    stripe.nextSignatureValid = false;

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'bad' },
      payload: rawJson({ id: 'evt_bad' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatch(/invalid signature/i);
  });

  // -------------------------------------------------------------------------
  // Test 4: invoice.paid (subscription_create) → activated
  // -------------------------------------------------------------------------

  it('invoice.paid subscription_create: creates membership + invoice + garage snapshot', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    stripe.nextEvent = invoicePaidEvent('subscription_create', 'evt_activated_1');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    const evt = await prisma.subscriptionWebhookEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: { provider: 'stripe', providerEventId: 'evt_activated_1' },
      },
    });
    expect(evt.processedAt).not.toBeNull();
    expect(evt.payload).toBeTruthy();

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership).not.toBeNull();
    expect(membership!.status).toBe('active');
    expect(membership!.provider).toBe('stripe');
    expect(membership!.tier).toBe('gold');
    expect(membership!.cadence).toBe('monthly');
    expect(membership!.devFeePercent).toBe(10);

    const invoice = await prisma.premiumMembershipInvoice.findFirst({
      where: { membershipId: membership!.id },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.grossAmountCents).toBe(4990);
    expect(invoice!.status).toBe('paid');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 5: invoice.paid (subscription_cycle) → renewed
  // -------------------------------------------------------------------------

  it('invoice.paid subscription_cycle: creates renewal invoice for existing membership', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    await seedActiveMembership(garageId);
    stripe.nextEvent = invoicePaidEvent('subscription_cycle', 'evt_renewed_1');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { providerInvoiceRef: 'in_test_001', provider: 'stripe' },
    });
    expect(invoices.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: invoice.payment_failed → past_due
  // -------------------------------------------------------------------------

  it('invoice.payment_failed: sets membership status to past_due', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    await seedActiveMembership(garageId);

    stripe.nextEvent = {
      id: 'evt_past_due_1',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_test_001', customer: 'cus_test_001' } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('past_due');
  });

  // -------------------------------------------------------------------------
  // Test 7: subscription.updated cancel_at_period_end=true → cancel_scheduled
  // -------------------------------------------------------------------------

  it('subscription.updated cancel_at_period_end=true: sets status cancel_scheduled', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    await seedActiveMembership(garageId);

    stripe.nextEvent = subscriptionUpdatedEvent(
      'evt_cancel_1',
      { cancel_at_period_end: true },
      { cancel_at_period_end: false },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('cancel_scheduled');
    expect(membership!.cancelAtPeriodEnd).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: subscription.updated cancel_at_period_end=false → active
  // -------------------------------------------------------------------------

  it('subscription.updated cancel_at_period_end=false: restores status to active', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    await seedActiveMembership(garageId, {
      status: 'cancel_scheduled',
      cancelAtPeriodEnd: true,
    });

    stripe.nextEvent = subscriptionUpdatedEvent(
      'evt_uncancel_1',
      { cancel_at_period_end: false },
      { cancel_at_period_end: true },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('active');
    expect(membership!.cancelAtPeriodEnd).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 9: subscription.updated price swap → tier_changed
  // -------------------------------------------------------------------------

  it('subscription.updated price swap: updates cadence in membership', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    await seedActiveMembership(garageId, { cadence: 'annual' });

    stripe.nextEvent = subscriptionUpdatedEvent(
      'evt_tier_change_1',
      {},
      {
        items: {
          data: [
            {
              price: {
                id: 'price_annual_test',
                metadata: { baseAmountCents: '47880', devFeePercent: '10' },
                recurring: { interval: 'year' },
              },
            },
          ],
        },
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.cadence).toBe('monthly');
  });

  // -------------------------------------------------------------------------
  // Test 10: subscription.deleted → expired + garage snapshot cleared
  // -------------------------------------------------------------------------

  it('subscription.deleted: sets status expired and clears garage snapshot when appropriate', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    await seedActiveMembership(garageId);
    await prisma.garage.update({
      where: { id: garageId },
      data: { premiumTier: 'gold', premiumUntil: new Date(Date.now() - 1000) },
    });

    stripe.nextEvent = {
      id: 'evt_deleted_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_001',
          customer: 'cus_test_001',
          cancel_at_period_end: false,
          canceled_at: Math.floor(Date.now() / 1000) - 100,
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('expired');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 11: charge.refunded → invoice status only (canon §F8.10)
  // -------------------------------------------------------------------------

  it('charge.refunded: flips invoice to refunded, leaves membership active', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    const membershipId = await seedActiveMembership(garageId);
    const invoice = await prisma.premiumMembershipInvoice.create({
      data: {
        membershipId,
        provider: 'stripe',
        providerInvoiceRef: 'in_test_001',
        periodStart: new Date(1748300000 * 1000),
        periodEnd: new Date(1750892000 * 1000),
        baseAmountCents: 4536,
        devFeePercent: 10,
        devFeeAmountCents: 454,
        grossAmountCents: 4990,
        currency: 'BRL',
        paidAt: new Date(),
        status: 'paid',
      },
    });

    stripe.nextEvent = {
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: {
        object: {
          invoice: 'in_test_001',
          amount: 4990,
          amount_refunded: 4990,
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const updated = await prisma.premiumMembershipInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(updated.status).toBe('refunded');
    expect(updated.refundedAmountCents).toBe(4990);
    expect(updated.refundedAt).not.toBeNull();

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // Test 12: Replay (same providerEventId) → 200 OK + deduped, no duplicate writes
  // -------------------------------------------------------------------------

  it('replay of same event ID short-circuits at 200 OK (canon §F8.15)', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    const evt = invoicePaidEvent('subscription_create', 'evt_replay_1');

    stripe.nextEvent = evt;
    const r1 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(evt),
    });
    expect(r1.statusCode).toBe(200);

    const countBefore = await prisma.premiumMembership.count({ where: { garageId } });

    stripe.nextEvent = evt;
    const r2 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(evt),
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ ok: true, deduped: true });

    const countAfter = await prisma.premiumMembership.count({ where: { garageId } });
    expect(countAfter).toBe(countBefore);
  });

  // -------------------------------------------------------------------------
  // Test 13: Stale unprocessed event (processedAt=null) → 503 so Stripe retries
  // Guards against the silent-drop race where Request 1 inserted the
  // SubscriptionWebhookEvent row, then crashed mid-apply, and Request 2 hits
  // P2002 on the unique (provider, providerEventId) index. Without the
  // processedAt inspection the route would 200/deduped and the event would
  // never apply.
  // -------------------------------------------------------------------------

  it('replay of unprocessed event (stale crashed attempt) returns 503 to trigger Stripe retry', async () => {
    ({ app, stripe } = await buildBillingApp(true));
    const evt = invoicePaidEvent('subscription_create', 'evt_stale_unprocessed_1');

    // Simulate a prior attempt that inserted the row but never marked it processed.
    await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: 'stripe',
        providerEventId: 'evt_stale_unprocessed_1',
        type: 'invoice.paid',
        payload: evt as unknown as Prisma.InputJsonValue,
        processedAt: null,
      },
    });

    stripe.nextEvent = evt;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(evt),
    });

    expect(res.statusCode).toBe(503);
    expect(res.payload).toMatch(/concurrent or stale/i);
  });
});
