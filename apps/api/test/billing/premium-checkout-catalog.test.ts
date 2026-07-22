/**
 * Integration tests for the P5 catalog-aware checkout price resolution and the
 * webhook add-ons amount reconciliation.
 *
 *   POST /api/me/premium/checkout   — catalog stripePriceId preferred, GOLD env
 *                                     fallback preserved when catalog unwired.
 *   POST /webhooks/stripe-billing   — customer.subscription.updated reconciles
 *                                     PremiumMembership.addonsAmountCents.
 *
 * Real Testcontainers Postgres + FakeStripe injected through buildApp.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const originalMonthly = process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
const originalSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  if (originalMonthly === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = originalMonthly;
  if (originalSecret === undefined) delete process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  else process.env.STRIPE_BILLING_WEBHOOK_SECRET = originalSecret;
};

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumAddonRedemption.deleteMany();
  await prisma.premiumAddonUsage.deleteMany();
  await prisma.premiumMembershipAddon.deleteMany();
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const garageOf = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

const seedGoldPlan = (monthlyStripePriceId: string | null) =>
  prisma.premiumPlan.create({
    data: {
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      sortOrder: 0,
      prices: {
        create: [
          {
            cadence: 'monthly',
            baseAmountCents: 2990,
            currency: 'BRL',
            stripePriceId: monthlyStripePriceId,
          },
        ],
      },
    },
  });

describe('POST /api/me/premium/checkout — catalog-aware price resolution', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let env: ReturnType<typeof loadEnv>;

  const buildCheckoutApp = async (): Promise<void> => {
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = 'price_env_gold_monthly';
    stripe = buildFakeStripe();
    stripe.nextSubscriptionCheckoutSession = {
      id: 'cs_test',
      url: 'https://checkout.stripe.com/pay/cs_test',
    };
    stripe.nextFoundOrCreatedCustomer = { customerId: 'cus_test' };
    app = await buildApp(loadEnv(), { stripe });
    env = loadEnv();
  };

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    await buildCheckoutApp();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  const checkout = (userId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, userId) },
      payload,
    });

  it('uses the catalog stripePriceId when present', async () => {
    const { user } = await createUser({ verified: true });
    await garageOf(user.id);
    await seedGoldPlan('price_catalog_gold_monthly');

    const res = await checkout(user.id, { cadence: 'monthly' });
    expect(res.statusCode).toBe(201);
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect((subCall!.payload as { priceId: string }).priceId).toBe('price_catalog_gold_monthly');
  });

  it('falls back to the GOLD env price when the catalog has no stripePriceId', async () => {
    const { user } = await createUser({ verified: true });
    await garageOf(user.id);
    await seedGoldPlan(null);

    const res = await checkout(user.id, { cadence: 'monthly' });
    expect(res.statusCode).toBe(201);
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect((subCall!.payload as { priceId: string }).priceId).toBe('price_env_gold_monthly');
  });

  it('falls back to the GOLD env price when no catalog plan exists (legacy behavior)', async () => {
    const { user } = await createUser({ verified: true });
    await garageOf(user.id);

    const res = await checkout(user.id, { cadence: 'monthly' });
    expect(res.statusCode).toBe(201);
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect((subCall!.payload as { priceId: string }).priceId).toBe('price_env_gold_monthly');
  });

  it('resolves the tier from planSlug and uses its catalog stripePriceId', async () => {
    const { user } = await createUser({ verified: true });
    await garageOf(user.id);
    await seedGoldPlan('price_catalog_gold_monthly');

    const res = await checkout(user.id, { cadence: 'monthly', planSlug: 'gold' });
    expect(res.statusCode).toBe(201);
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect((subCall!.payload as { priceId: string }).priceId).toBe('price_catalog_gold_monthly');
  });

  it('returns 404 for an unknown planSlug', async () => {
    const { user } = await createUser({ verified: true });
    await garageOf(user.id);

    const res = await checkout(user.id, { cadence: 'monthly', planSlug: 'does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /webhooks/stripe-billing — add-ons amount reconciliation', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  const buildWebhookApp = async (): Promise<void> => {
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test_billing_webhook_secret_32chars';
    stripe = buildFakeStripe();
    app = await buildApp(loadEnv(), { stripe });
  };

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    await buildWebhookApp();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  const subscriptionUpdatedEvent = (eventId: string, subRef: string): WebhookEvent => ({
    id: eventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: subRef,
        customer: 'cus_test_001',
        cancel_at_period_end: false,
        current_period_start: 1748300000,
        current_period_end: 1750892000,
        canceled_at: null,
        items: {
          data: [
            { price: { id: 'price_monthly_test', metadata: {}, recurring: { interval: 'month' } } },
          ],
        },
        // No previous_attributes → normalizes to null; the addons seam still runs.
      },
    },
  });

  it('reconciles addonsAmountCents from active add-on rows on subscription.updated', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const now = new Date();
    const membership = await prisma.premiumMembership.create({
      data: {
        garageId: g.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_test_001',
        providerSubRef: 'sub_reconcile_1',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600_000),
        cancelAtPeriodEnd: false,
        baseAmountCents: 2990,
        devFeePercent: 10,
        devFeeAmountCents: 299,
        grossAmountCents: 2990,
        currency: 'BRL',
        // Stale snapshot — reconcile must correct this from the active add-on rows.
        addonsAmountCents: 999,
      },
    });
    await prisma.premiumAddonModule.create({
      data: {
        key: 'wash',
        name: 'Lavagem',
        description: 'x',
        monthlyDeltaCents: 1990,
        currency: 'BRL',
        quotaPerCycle: 4,
        quotaUnit: 'access',
        active: true,
      },
    });
    await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: 'wash',
        status: 'active',
        providerItemRef: 'si_x',
        monthlyDeltaCents: 1990,
        quotaPerCycle: 4,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });

    stripe.nextEvent = subscriptionUpdatedEvent('evt_reconcile_1', 'sub_reconcile_1');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(after.addonsAmountCents).toBe(1990);
  });
});
