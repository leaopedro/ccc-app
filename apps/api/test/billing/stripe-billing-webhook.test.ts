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
    },
    // Sibling of object, matching a real Stripe envelope. Nesting it inside
    // object made every discriminator in this suite pass against a shape the
    // normalizer never sees in production.
    previous_attributes: previousAttributes,
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
    // These fixtures were written in the gold-only tierFromPrice() era and never
    // seeded a catalog. Now that the route resolves tier/baseAmountCents against
    // PremiumPlanPrice, 'price_monthly_test' (used by every fixture below) must
    // exist in the catalog or the catalog-miss guard refuses activation.
    await prisma.premiumAddonModule.deleteMany();
    await prisma.premiumPlanPrice.deleteMany();
    await prisma.premiumPlan.deleteMany();
    const goldPlan = await prisma.premiumPlan.create({
      data: { tier: 'gold', slug: 'fundador', name: 'Fundador', active: true, sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: goldPlan.id,
        cadence: 'monthly',
        baseAmountCents: 4536,
        currency: 'BRL',
        stripePriceId: 'price_monthly_test',
        active: true,
      },
    });
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

  it('persists the event and asks Stripe to retry when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
    // Used to return 200 before persisting anything: Stripe marked the event
    // delivered and there was no replay path. That made the subscription smoke
    // impossible in the documented go-live order (smoke, THEN flip the flag),
    // because with the flag off the checkout 503s and the webhook was discarded.
    // 503 + a stored, unprocessed row means the window's events survive the flip.
    ({ app, stripe } = await buildBillingApp(false));
    stripe.nextEvent = invoicePaidEvent('subscription_create', 'evt_flag_disabled_1');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(503);

    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_flag_disabled_1' },
    });
    expect(row.processedAt).toBeNull();

    // Still no side effects: nothing was applied, only recorded.
    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  it('counts redeliveries of an unprocessed event so a stuck one can be escalated', async () => {
    // A deterministically failing apply used to just 503 until Stripe gave up
    // after ~3 days, losing the event with nothing louder than a warning.
    ({ app, stripe } = await buildBillingApp(true));
    stripe.nextEvent = invoicePaidEvent('subscription_create', 'evt_attempts_1');

    // Seed the row as unprocessed, which is the state a crashed prior attempt
    // leaves behind.
    await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: 'stripe',
        providerEventId: 'evt_attempts_1',
        type: 'invoice.paid',
        payload: {},
      },
    });

    for (const expected of [1, 2]) {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/stripe-billing',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(res.statusCode).toBe(503);

      const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
        where: { providerEventId: 'evt_attempts_1' },
      });
      expect(row.attempts).toBe(expected);
    }
  });

  it('processes a stored unprocessed event once the flag is on', async () => {
    // The gap the review caught: storing the event while the flag was off did
    // nothing, because every retry bounced off the duplicate-event branch with
    // 503 before reaching the flag gate or the dispatch. Stripe keeps the same
    // event id on redelivery, so the row was unreachable forever — a paid
    // subscription that never becomes a membership.
    const eventId = 'evt_stored_then_enabled';

    ({ app, stripe } = await buildBillingApp(false));
    const { garageId } = await seedGarageWithStripeCustomer(stripe, 'cus_test_001');
    stripe.nextEvent = invoicePaidEvent('subscription_create', eventId);

    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(first.statusCode).toBe(503);
    expect(await prisma.premiumMembership.count()).toBe(0);

    // Age the row past STALE_UNPROCESSED_MS. A real redelivery arrives minutes
    // later; the age check is what separates that from true concurrency.
    await prisma.subscriptionWebhookEvent.updateMany({
      where: { providerEventId: eventId },
      data: { receivedAt: new Date(Date.now() - 5 * 60_000) },
    });

    await app.close();
    ({ app, stripe } = await buildBillingApp(true));
    stripe.customers.set('cus_test_001', { garageId });
    stripe.nextEvent = invoicePaidEvent('subscription_create', eventId);

    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(second.statusCode).toBe(200);
    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
    });
    expect(row.processedAt).not.toBeNull();
    expect(await prisma.premiumMembership.count()).toBe(1);
  });

  it('still answers 503 for a genuinely concurrent unprocessed delivery', async () => {
    // Same shape, but the row is fresh, so this is another delivery in flight
    // rather than an abandoned attempt. Must NOT double-apply.
    const eventId = 'evt_concurrent_unprocessed';
    ({ app, stripe } = await buildBillingApp(true));
    await seedGarageWithStripeCustomer(stripe, 'cus_test_001');

    await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: 'stripe',
        providerEventId: eventId,
        type: 'invoice.paid',
        payload: {},
      },
    });

    stripe.nextEvent = invoicePaidEvent('subscription_create', eventId);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(503);
    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  it('rejects an unsigned payload before persisting, even with the flag off', async () => {
    // The gate moved below the signature check, so unauthenticated garbage must
    // not reach the audit table.
    ({ app, stripe } = await buildBillingApp(false));
    stripe.nextEvent = invoicePaidEvent('subscription_create', 'evt_flag_disabled_unsigned');
    stripe.nextSignatureValid = false;

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.subscriptionWebhookEvent.count()).toBe(0);
  });

  it('returns 503 and leaves the event unprocessed when the payload shape is unrecognized', async () => {
    // A 2026+ shape invoice.paid. Answering 200 here would mark it processed and
    // stop Stripe retrying: the card is charged and no membership exists. 503
    // keeps it redeliverable once the endpoint is repinned to the API version
    // this normalizer parses.
    ({ app, stripe } = await buildBillingApp(true));
    stripe.nextEvent = {
      id: 'evt_unrecognized_shape_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_test_new_shape',
          customer: 'cus_test_001',
          billing_reason: 'subscription_create',
          amount_paid: 4990,
          currency: 'brl',
          period_start: 1748300000,
          period_end: 1750892000,
          parent: { subscription_details: { subscription: 'sub_test_001' } },
          lines: { data: [{ pricing: { price_details: { price: 'price_monthly_test' } } }] },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=anything' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(503);

    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_unrecognized_shape_1' },
    });
    expect(row.processedAt).toBeNull();

    // And nothing was provisioned off an invoice we could not read.
    expect(await prisma.premiumMembership.count()).toBe(0);
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
    // Regression guard: the synthetic line built for tier_changed resolution
    // must carry the new price's real metadata, not a hardcoded {}. A
    // hardcoded {} would zero devFeePercent/devFeeAmountCents on every tier
    // change (Fix round 1, finding 2).
    expect(membership!.devFeePercent).toBe(10);
    expect(membership!.devFeeAmountCents).toBe(454);
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

  it('replay of a FRESH unprocessed event returns 503 to trigger Stripe retry', async () => {
    // Renamed 2026-08-13. This test creates the row with receivedAt = now, so it
    // exercises the CONCURRENT case, not a stale one — the old name said
    // "stale crashed attempt" and asserted 503, which encoded as intended
    // behaviour the very bug review found: a genuinely abandoned row could never
    // be processed, because every retry bounced here. A row older than
    // STALE_UNPROCESSED_MS now resumes instead; see
    // "processes a stored unprocessed event once the flag is on".
    ({ app, stripe } = await buildBillingApp(true));
    const evt = invoicePaidEvent('subscription_create', 'evt_stale_unprocessed_1');

    // Simulate another delivery in flight: row inserted, not yet processed.
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
    expect(res.payload).toMatch(/concurrent/i);
  });
});

describe('multi-line invoice resolution', () => {
  // Fix round 1, finding 7: this describe has its own catalog fixtures and
  // must reset the DB between tests like every other catalog-touching test
  // file (matching the pattern the other describe above uses). Without this,
  // once a later task makes handleActivated write PremiumMembershipAddon
  // rows, the next test's seedCatalog() → premiumAddonModule.deleteMany()
  // would hit the FK Restrict on PremiumMembershipAddon.module.
  beforeEach(async () => {
    await resetDatabase();
  });

  const seedCatalog = async () => {
    await prisma.premiumAddonModule.deleteMany();
    await prisma.premiumPlanPrice.deleteMany();
    await prisma.premiumPlan.deleteMany();
    const plan = await prisma.premiumPlan.create({
      data: { tier: 'silver', slug: 'estrada', name: 'Estrada', active: true, sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: plan.id,
        cadence: 'monthly',
        baseAmountCents: 89000,
        currency: 'BRL',
        stripePriceId: 'price_plan_silver',
        active: true,
      },
    });
    await prisma.premiumAddonModule.create({
      data: {
        key: 'detailing',
        name: 'Detailing',
        description: 'Lavagem detalhada',
        monthlyDeltaCents: 15000,
        // Nao-default de proposito: com 0/null o teste de snapshot abaixo
        // passaria mesmo se o webhook nunca copiasse estes campos.
        payoutAmountCents: 9000,
        vendorName: 'Lava Rapido X',
        currency: 'BRL',
        quotaPerCycle: 3,
        quotaUnit: 'access',
        active: true,
        stripePriceId: 'price_addon_detailing',
      },
    });
  };

  it('takes tier and baseAmountCents from the catalog, not from price metadata', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'multiline@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ml_1', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_1',
          subscription: 'sub_ml_1',
          customer: 'cus_ml_1',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: {
                  id: 'price_plan_silver',
                  metadata: { devFeePercent: '10' },
                  recurring: { interval: 'month' },
                },
                amount: 89000,
                subscription_item: 'si_plan_1',
              },
              {
                price: {
                  id: 'price_addon_detailing',
                  metadata: {},
                  recurring: { interval: 'month' },
                },
                amount: 15000,
                subscription_item: 'si_addon_1',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_ml_1' } },
    });
    expect(membership.tier).toBe('silver');
    expect(membership.baseAmountCents).toBe(89000);
    expect(membership.devFeePercent).toBe(10);
    expect(membership.devFeeAmountCents).toBe(8900);
    await app.close();
  });

  it('refuses to activate when no catalog plan price matches the invoice', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'catalogmiss@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ml_miss', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_miss',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_miss',
          subscription: 'sub_ml_miss',
          customer: 'cus_ml_miss',
          billing_reason: 'subscription_create',
          amount_paid: 89000,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                // Not in the catalog: an operator forgot to paste this price id.
                price: { id: 'price_never_registered', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_orphan',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    // 200 on purpose: Stripe must NOT redeliver, the fix is an operator action.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: true, reason: 'unknown-plan-price' });

    // The placeholder tier is a valid enum value, so the real assertion is that
    // NO membership was created rather than that some tier was written.
    const membership = await prisma.premiumMembership.findUnique({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_ml_miss' } },
    });
    expect(membership).toBeNull();

    // The event is marked processed so a replay short-circuits instead of 503ing.
    const evtRow = await prisma.subscriptionWebhookEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: 'stripe', providerEventId: 'evt_ml_miss' } },
    });
    expect(evtRow.processedAt).not.toBeNull();

    await app.close();
  });

  // Fix round 1, finding 1 (CRITICAL): the catalog-miss guard must also cover
  // renewals, not just activation. Without it, a renewal whose price was
  // retired from the catalog would patch baseAmountCents/devFeePercent/
  // devFeeAmountCents to zero and silently overwrite a previously-correct
  // membership snapshot — 200 OK, no log, no alert.
  it('refuses a renewal when the invoice price is not in the catalog, without zeroing the membership snapshot', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'renewalmiss@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ren_miss', { garageId: garage.id });

    const membership = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_ren_miss',
        providerSubRef: 'sub_ren_miss',
        tier: 'silver',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(1748300000 * 1000),
        currentPeriodEnd: new Date(1750892000 * 1000),
        cancelAtPeriodEnd: false,
        baseAmountCents: 89000,
        devFeePercent: 10,
        devFeeAmountCents: 8900,
        grossAmountCents: 97900,
        currency: 'BRL',
      },
    });

    stripe.nextEvent = {
      id: 'evt_renewal_miss_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_renewal_miss_1',
          subscription: 'sub_ren_miss',
          customer: 'cus_ren_miss',
          billing_reason: 'subscription_cycle',
          amount_paid: 97900,
          currency: 'brl',
          period_start: 1750892000,
          period_end: 1753484000,
          status_transitions: { paid_at: 1750892100 },
          lines: {
            data: [
              {
                // An operator retired this price from the admin catalog while
                // subscribers are still billed on it — the exact scenario the
                // catalog-miss guard exists to catch on renewal too.
                price: { id: 'price_plan_retired', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_plan_retired',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: true, reason: 'unknown-plan-price' });

    // The membership snapshot must NOT be zeroed by the refused renewal.
    const reloaded = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(reloaded.baseAmountCents).toBe(89000);
    expect(reloaded.devFeePercent).toBe(10);
    expect(reloaded.devFeeAmountCents).toBe(8900);

    // No invoice recorded for the refused renewal.
    const invoiceCount = await prisma.premiumMembershipInvoice.count({
      where: { membershipId: membership.id },
    });
    expect(invoiceCount).toBe(0);

    const evtRow = await prisma.subscriptionWebhookEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: { provider: 'stripe', providerEventId: 'evt_renewal_miss_1' },
      },
    });
    expect(evtRow.processedAt).not.toBeNull();

    await app.close();
  });

  // Fix round 1, finding 3: an invoice with two lines that each match a
  // PremiumPlanPrice (e.g. a plan-change proration credit for the old price
  // alongside the new price's line) must not silently pick "whichever line
  // is first" — Stripe does not contract line ordering. Treat it as
  // ambiguous and refuse, exactly like a zero-match miss.
  it('refuses activation when more than one invoice line matches a catalog plan price (ambiguous)', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const goldPlan = await prisma.premiumPlan.create({
      data: { tier: 'gold', slug: 'fundador', name: 'Fundador', active: true, sortOrder: 1 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: goldPlan.id,
        cadence: 'monthly',
        baseAmountCents: 149000,
        currency: 'BRL',
        stripePriceId: 'price_plan_gold',
        active: true,
      },
    });

    const { user } = await createUser({ email: 'ambiguous@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ambig_1', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ambig_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ambig_1',
          subscription: 'sub_ambig_1',
          customer: 'cus_ambig_1',
          billing_reason: 'subscription_create',
          amount_paid: 60000,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                // Proration credit for the old (silver) price.
                price: { id: 'price_plan_silver', metadata: {} },
                amount: -89000,
                subscription_item: 'si_credit',
              },
              {
                price: { id: 'price_plan_gold', metadata: { devFeePercent: '10' } },
                amount: 149000,
                subscription_item: 'si_new',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: true, reason: 'unknown-plan-price' });

    const membership = await prisma.premiumMembership.findUnique({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_ambig_1' } },
    });
    expect(membership).toBeNull();

    await app.close();
  });

  // Fix round 2, finding: the SAME price appearing on two invoice lines
  // (a proration credit for a partial period, plus the full charge) is NOT
  // ambiguous — both lines resolve to the same PremiumPlanPrice row. Counting
  // raw lines instead of distinct matched prices would have wrongly refused
  // this as ambiguous. This is the other side of the boundary from the
  // "ambiguous" test above (two DIFFERENT prices, which must still refuse).
  it('resolves a single catalog plan price even when it appears on two invoice lines (credit + charge)', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'sameprice@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_sameprice_1', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_sameprice_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_sameprice_1',
          subscription: 'sub_sameprice_1',
          customer: 'cus_sameprice_1',
          billing_reason: 'subscription_create',
          amount_paid: 44500,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                // A proration credit for a partial period at the same price,
                // then the full charge for the new period — both reference
                // the SAME registered price. Not ambiguous.
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: -44500,
                subscription_item: 'si_credit',
              },
              {
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_charge',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: {
        provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_sameprice_1' },
      },
    });
    expect(membership.tier).toBe('silver');
    expect(membership.baseAmountCents).toBe(89000);
    expect(membership.devFeePercent).toBe(10);

    await app.close();
  });

  // Fix round 1, finding 4: cadence must come from the resolved
  // PremiumPlanPrice row, not from invoice lines.data[0].price.recurring —
  // an add-on line sorting first must not misrecord an annual plan as
  // monthly.
  it('resolves cadence from the catalog, not from invoice line order', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const plan = await prisma.premiumPlan.findUniqueOrThrow({ where: { tier: 'silver' } });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: plan.id,
        cadence: 'annual',
        baseAmountCents: 890000,
        currency: 'BRL',
        stripePriceId: 'price_plan_silver_annual',
        active: true,
      },
    });

    const { user } = await createUser({ email: 'cadenceorder@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_cad_1', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_cad_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_cad_1',
          subscription: 'sub_cad_1',
          customer: 'cus_cad_1',
          billing_reason: 'subscription_create',
          amount_paid: 905000,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1798761600,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              // The add-on line sorts first. If cadence were still read from
              // lines.data[0].price.recurring.interval (monthly), an annual
              // plan would be misrecorded as monthly.
              {
                price: {
                  id: 'price_addon_detailing',
                  metadata: {},
                  recurring: { interval: 'month' },
                },
                amount: 15000,
                subscription_item: 'si_addon_1',
              },
              {
                price: {
                  id: 'price_plan_silver_annual',
                  metadata: { devFeePercent: '10' },
                  recurring: { interval: 'year' },
                },
                amount: 890000,
                subscription_item: 'si_plan_1',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_cad_1' } },
    });
    expect(membership.cadence).toBe('annual');
    expect(membership.baseAmountCents).toBe(890000);

    await app.close();
  });

  // Fix round 1, finding 5: a malformed devFeePercent (e.g. an operator typo
  // in Stripe Price metadata) must not crash the route. NaN would otherwise
  // reach the Prisma Int write, 500, and poison the SubscriptionWebhookEvent
  // row (already inserted with processedAt: null) into an endless 503-retry
  // loop.
  it('rejects a non-numeric devFeePercent instead of writing NaN, and does not crash', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'baddevfee@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_baddevfee_1', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_baddevfee_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_baddevfee_1',
          subscription: 'sub_baddevfee_1',
          customer: 'cus_baddevfee_1',
          billing_reason: 'subscription_create',
          amount_paid: 89000,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: {
                  id: 'price_plan_silver',
                  metadata: { devFeePercent: 'ten' },
                  recurring: { interval: 'month' },
                },
                amount: 89000,
                subscription_item: 'si_plan_1',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_baddevfee_1' } },
    });
    expect(membership.devFeePercent).toBe(0);
    expect(membership.devFeeAmountCents).toBe(0);

    await app.close();
  });

  it('creates the add-on and its usage cycle in the activation transaction', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'addontx@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ml_2', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_2',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_2',
          subscription: 'sub_ml_2',
          customer: 'cus_ml_2',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_plan_2',
              },
              {
                // Fix round (Task 22): deliberately DIFFERENT from the catalog's
                // monthlyDeltaCents (15000) — simulates a prorated invoice line.
                // Every other fixture in this file happens to set these equal,
                // which would hide a regression back to summing invoice-line
                // amounts instead of the catalog. See addonsAmountCents assertion
                // below: it must reflect the catalog sum (15000), not this 7500.
                price: { id: 'price_addon_detailing', metadata: {} },
                amount: 7500,
                subscription_item: 'si_addon_2',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_ml_2' } },
    });
    // Must be the catalog sum (15000), NOT the invoice-line sum (7500) above.
    expect(membership.addonsAmountCents).toBe(15000);

    const addon = await prisma.premiumMembershipAddon.findUniqueOrThrow({
      where: { membershipId_addonKey: { membershipId: membership.id, addonKey: 'detailing' } },
    });
    expect(addon.status).toBe('active');
    expect(addon.providerItemRef).toBe('si_addon_2');
    expect(addon.monthlyDeltaCents).toBe(15000);
    expect(addon.quotaPerCycle).toBe(3);
    // Snapshot de repasse e fornecedor, igual ao que attachAddon grava. Sem
    // isso a tela de admin mostra repasse 0 e fornecedor vazio para um modulo
    // que a Stripe criou junto com a assinatura.
    expect(addon.payoutAmountCents).toBe(9000);
    expect(addon.vendorName).toBe('Lava Rapido X');

    const usage = await prisma.premiumAddonUsage.findFirstOrThrow({
      where: { membershipAddonId: addon.id },
    });
    expect(usage.quotaTotal).toBe(3);
    expect(usage.quotaUsed).toBe(0);
    expect(usage.cycleStart.toISOString()).toBe(membership.currentPeriodStart.toISOString());

    await app.close();
  });

  it('reactivates a previously cancelled add-on instead of violating the unique', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'readd@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Fix round 1, finding 1: the incoming invoice's period (period_start
    // 1767225600 / period_end 1769904000 below) decodes to
    // 2026-01-01T00:00:00.000Z .. 2026-02-01T00:00:00.000Z. This membership's
    // period must end strictly BEFORE that for the event to land on the
    // forward-advance branch — the re-subscribe case this test's title
    // promises — rather than the stale-replay branch. The stale-replay case
    // (a cancelled add-on must NOT be resurrected by an out-of-order event)
    // is covered separately by the next test below.
    const stale = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_ml_3',
        providerSubRef: 'sub_ml_3',
        tier: 'silver',
        cadence: 'monthly',
        status: 'expired',
        currentPeriodStart: new Date('2025-12-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-01-01T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
        baseAmountCents: 89000,
        devFeePercent: 10,
        devFeeAmountCents: 8900,
        grossAmountCents: 97900,
        currency: 'BRL',
      },
    });
    await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: stale.id,
        addonKey: 'detailing',
        status: 'cancelled',
        providerItemRef: 'si_old',
        monthlyDeltaCents: 15000,
        quotaPerCycle: 3,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });

    stripe.customers.set('cus_ml_3', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_3',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_3',
          subscription: 'sub_ml_3',
          customer: 'cus_ml_3',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_plan_3',
              },
              {
                price: { id: 'price_addon_detailing', metadata: {} },
                amount: 15000,
                subscription_item: 'si_addon_3',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const addon = await prisma.premiumMembershipAddon.findUniqueOrThrow({
      where: { membershipId_addonKey: { membershipId: stale.id, addonKey: 'detailing' } },
    });
    expect(addon.status).toBe('active');
    expect(addon.providerItemRef).toBe('si_addon_3');
    await app.close();
  });

  // Fix round 1, findings 1 and 2: an adversarial review found that the
  // add-on loop used to run unconditionally, including on the stale-replay
  // branch. A delayed/duplicate activation webhook carrying an OLDER period
  // than the membership's current one would then resurrect a cancelled
  // add-on and overwrite providerItemRef with a subscription item the detach
  // route already deleted on Stripe's side — quota nobody is paying for.
  // This asserts the fix: gating the add-on loop on didAdvancePeriod, exactly
  // like the Garage snapshot immediately below it in handleActivated.
  it('does not resurrect a cancelled add-on on a stale (out-of-order) activation replay', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'staleaddon@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Membership already advanced past the incoming event's period — e.g. a
    // later renewal or activation already landed before this delayed replay
    // arrives.
    const membership = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_ml_4',
        providerSubRef: 'sub_ml_4',
        tier: 'silver',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date('2026-02-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-03-01T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
        baseAmountCents: 89000,
        devFeePercent: 10,
        devFeeAmountCents: 8900,
        grossAmountCents: 97900,
        currency: 'BRL',
      },
    });
    const cancelledAddon = await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: 'detailing',
        status: 'cancelled',
        providerItemRef: 'si_addon_stale_old',
        monthlyDeltaCents: 15000,
        quotaPerCycle: 3,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });

    stripe.customers.set('cus_ml_4', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_4',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_4',
          subscription: 'sub_ml_4',
          customer: 'cus_ml_4',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          // Decodes to 2026-01-01T00:00:00.000Z .. 2026-02-01T00:00:00.000Z —
          // strictly BEFORE membership.currentPeriodEnd (2026-03-01), so this
          // is a genuine stale/out-of-order replay.
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_plan_4',
              },
              {
                price: { id: 'price_addon_detailing', metadata: {} },
                amount: 15000,
                subscription_item: 'si_addon_stale_new',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const addon = await prisma.premiumMembershipAddon.findUniqueOrThrow({
      where: { id: cancelledAddon.id },
    });
    expect(addon.status).toBe('cancelled');
    expect(addon.providerItemRef).toBe('si_addon_stale_old');

    const usageCount = await prisma.premiumAddonUsage.count({
      where: { membershipAddonId: cancelledAddon.id },
    });
    expect(usageCount).toBe(0);

    const reloaded = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(reloaded.addonsAmountCents).toBe(0);

    await app.close();
  });
});
