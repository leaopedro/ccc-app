import { prisma } from '@ccc/db';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

// GROWTH_PREMIUM_BILLING_ENABLED is a process-wide flag other test files
// toggle directly (and at least two of them never restore it on 'false' —
// a separate, already-flagged issue). Force it here so this file is
// deterministic regardless of run order, matching the pattern used by
// premium-checkout-catalog.test.ts / me-premium.test.ts.
const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
};

const resetCatalog = async () => {
  await prisma.premiumAddonModule.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlan.deleteMany();
};

const seedPlan = async (stripePriceId: string | null) => {
  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', active: true, sortOrder: 0 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 149000,
      currency: 'BRL',
      stripePriceId,
      active: true,
    },
  });
  return plan;
};

const seedModule = (key: string, stripePriceId: string | null) =>
  prisma.premiumAddonModule.create({
    data: {
      key,
      name: key,
      description: `modulo ${key}`,
      monthlyDeltaCents: 15000,
      currency: 'BRL',
      quotaPerCycle: 3,
      quotaUnit: 'access',
      active: true,
      stripePriceId,
    },
  });

describe('POST /api/me/premium/checkout with add-ons', () => {
  beforeEach(async () => {
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    await resetDatabase();
    await resetCatalog();
  });

  afterEach(() => {
    restoreEnv();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sends line items as [plan, ...modules] in order', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', 'price_addon_detailing');
    await seedModule('oficina', 'price_addon_oficina');
    const { user } = await createUser({ email: 'lines@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['oficina', 'detailing'] },
    });

    expect(res.statusCode).toBe(201);
    const call = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    const payload = call?.payload as { priceIds: string[] };
    expect(payload.priceIds[0]).toBe('price_plan_gold');
    expect(payload.priceIds.slice(1).sort()).toEqual([
      'price_addon_detailing',
      'price_addon_oficina',
    ]);
    await app.close();
  });

  it('503s listing the module keys missing a stripePriceId', async () => {
    const { app } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', null);
    const { user } = await createUser({ email: 'nolabel@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: 'ServiceUnavailable',
      missingAddonKeys: ['detailing'],
    });
    await app.close();
  });

  it('400s on an unknown add-on key', async () => {
    const { app } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'unknown@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['inexistente'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest', unknownAddonKeys: ['inexistente'] });
    await app.close();
  });

  it('422s when addonKeys exceeds 10 entries', async () => {
    const { app } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'toomany@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        cadence: 'monthly',
        planSlug: 'fundador',
        addonKeys: Array.from({ length: 11 }, (_, i) => `m${i}`),
      },
    });

    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('derives a different idempotency key per package selection', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', 'price_addon_detailing');
    const { user } = await createUser({ email: 'idem@jdm.test' });
    const auth = { authorization: bearer(env, user.id) };

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: auth,
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: [] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: auth,
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
    });

    const keys = stripe.calls
      .filter((c) => c.kind === 'createSubscriptionCheckoutSession')
      .map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    await app.close();
  });

  it('derives a different idempotency key when the resolved stripePriceId changes for the same selection', async () => {
    // Regression guard: the digest must cover the RESOLVED price ids, not the
    // client-supplied selection. An operator rotating the catalog price
    // between two attempts (same garage, cadence, planSlug, add-ons) must
    // still mint a fresh idempotency key, or Stripe answers the reused key
    // carrying different params with a 400 idempotency_error.
    const { app, stripe } = await makeAppWithFakeStripe();
    const plan = await seedPlan('price_plan_gold_v1');
    const { user } = await createUser({ email: 'rotate@jdm.test' });
    const auth = { authorization: bearer(env, user.id) };
    const payload = { cadence: 'monthly' as const, planSlug: 'fundador', addonKeys: [] };

    await app.inject({ method: 'POST', url: '/api/me/premium/checkout', headers: auth, payload });

    await prisma.premiumPlanPrice.updateMany({
      where: { planId: plan.id, cadence: 'monthly' },
      data: { stripePriceId: 'price_plan_gold_v2' },
    });

    await app.inject({ method: 'POST', url: '/api/me/premium/checkout', headers: auth, payload });

    const calls = stripe.calls.filter((c) => c.kind === 'createSubscriptionCheckoutSession');
    const keys = calls.map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    const priceIds = calls.map((c) => (c.payload as { priceIds: string[] }).priceIds[0]);
    expect(priceIds).toEqual(['price_plan_gold_v1', 'price_plan_gold_v2']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    await app.close();
  });

  it('expires the open session before creating a new one', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'stale@jdm.test' });
    stripe.nextOpenSubscriptionCheckoutSessions = [
      { id: 'cs_stale_1', url: 'https://checkout.stripe.com/pay/cs_stale_1' },
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: [] },
    });

    expect(res.statusCode).toBe(201);
    const expireCall = stripe.calls.find((c) => c.kind === 'expireCheckoutSession');
    expect(expireCall?.payload).toEqual({ sessionId: 'cs_stale_1' });
    await app.close();
  });

  it('still mints a new session when expiring the stale one fails (best-effort housekeeping)', async () => {
    // Regression guard for the expire-is-not-a-precondition decision: Stripe
    // 400s (invalid_request) when the session already closed between our list
    // call and the expire call (e.g. the member paid in another tab), and any
    // outage on this call must not block a member who otherwise has a valid
    // checkout ahead of them.
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'expirefails@jdm.test' });
    stripe.nextOpenSubscriptionCheckoutSessions = [
      { id: 'cs_stale_2', url: 'https://checkout.stripe.com/pay/cs_stale_2' },
    ];
    stripe.nextExpireCheckoutSessionError = new Error(
      'No such checkout.session (already expired or completed)',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: [] },
    });

    expect(res.statusCode).toBe(201);
    const expireCall = stripe.calls.find((c) => c.kind === 'expireCheckoutSession');
    expect(expireCall?.payload).toEqual({ sessionId: 'cs_stale_2' });
    const subCall = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    expect(subCall).toBeDefined();
    await app.close();
  });

  it('maps a Stripe session failure to a 503 (R1: mixed interval or currency)', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', 'price_addon_detailing');
    const { user } = await createUser({ email: 'mixed@jdm.test' });
    stripe.nextCreateSubscriptionCheckoutSessionError = new Error(
      'You cannot combine prices with different recurring intervals',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ServiceUnavailable' });
    await app.close();
  });

  it('points the return urls at the assinaturas module', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'urls@jdm.test' });

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    const call = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    const payload = call?.payload as { successUrl: string; cancelUrl: string };
    expect(payload.successUrl).toBe(`${env.APP_WEB_BASE_URL}/assinaturas/checkout-return`);
    expect(payload.cancelUrl).toBe(`${env.APP_WEB_BASE_URL}/assinaturas`);
    await app.close();
  });
});
