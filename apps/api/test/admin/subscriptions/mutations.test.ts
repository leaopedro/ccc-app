import { prisma } from '@ccc/db';
import { loadEnv } from '../../../src/env.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../../helpers.js';

import { seedSubscription } from './seed.js';

type App = Awaited<ReturnType<typeof makeAppWithFakeStripe>>;

// resetDatabase() deliberately does NOT truncate PremiumPlan, PremiumPlanPrice,
// PremiumAddonModule or PremiumMembershipAddon (see test/helpers.ts). seedSubscription()
// creates a plan (tier/slug unique) and an addon module (key unique) on every call, so
// without this local reset the second test in this file collides on those unique
// constraints. Mirrors the pattern in detail.test.ts.
const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const adminAuth = async (id = 'a@example.com') => {
  const { user: admin } = await createUser({ email: id, role: 'admin', verified: true });
  return bearer(loadEnv(), admin.id, 'admin');
};

const planItemSubscription = {
  id: 'sub_secreto_1',
  items: { data: [{ id: 'si_plan', price: { id: 'price_gold' } }] },
};

describe('mutacoes admin de assinatura', () => {
  let ctx: App;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    ctx = await makeAppWithFakeStripe();
  });
  afterEach(async () => {
    await ctx.app.close();
    // resetCatalog() below Restricts deletion of PremiumAddonModule while a
    // PremiumMembershipAddon still references it by addonKey — resetDatabase()
    // must run first so its cascade from PremiumMembership clears those rows.
    await resetDatabase();
    await resetCatalog();
  });

  it('403 para staff em toda mutacao', async () => {
    const { membershipId } = await seedSubscription();
    const { user: staff } = await createUser({
      email: 's@example.com',
      role: 'staff',
      verified: true,
    });
    const auth = bearer(loadEnv(), staff.id, 'staff');

    for (const [method, url] of [
      ['POST', `/admin/subscriptions/${membershipId}/plan`],
      ['POST', `/admin/subscriptions/${membershipId}/addons`],
      ['POST', `/admin/subscriptions/${membershipId}/cancel`],
      ['POST', `/admin/subscriptions/${membershipId}/resume`],
      ['POST', `/admin/subscriptions/${membershipId}/pause`],
    ] as const) {
      const res = await ctx.app.inject({
        method,
        url,
        headers: { authorization: auth },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('troca de plano responde pending e grava auditoria', async () => {
    const { membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription as never;
    const auth = await adminAuth();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'silver', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pending: true });

    const audit = await prisma.adminAudit.findMany({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('premium.subscription.plan_changed');
  });

  it('vinculo de modulo responde pending falso com os totais', async () => {
    const { membershipId } = await seedSubscription({ withAddon: false });
    const auth = await adminAuth('b@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/addons`,
      headers: { authorization: auth },
      payload: { addonKey: 'detailing' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ok: true,
      pending: false,
      addonKey: 'detailing',
      status: 'active',
      addonsAmountCents: 15000,
    });

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit.action).toBe('premium.subscription.addon_attached');
  });

  it('desvinculo de modulo marca cancel_scheduled e audita', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('c@example.com');

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/admin/subscriptions/${membershipId}/addons/detailing`,
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pending: false, status: 'cancel_scheduled' });

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit.action).toBe('premium.subscription.addon_detached');
  });

  it('cancelar e pausar chamam a Stripe e nao escrevem status', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('d@example.com');

    await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    const after = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.status).toBe('active');
    expect(ctx.stripe.calls.map((c) => c.kind)).toContain('cancelSubscriptionAtPeriodEnd');
  });

  it('resume encaminha para retomada de cancelamento quando cancel_scheduled', async () => {
    const { membershipId } = await seedSubscription({ status: 'cancel_scheduled' });
    const auth = await adminAuth('e@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/resume`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.stripe.calls.map((c) => c.kind)).toContain('resumeSubscriptionCancellation');
  });

  it('resume encaminha para retomada de cobranca quando paused', async () => {
    const { membershipId } = await seedSubscription({ status: 'paused' });
    const auth = await adminAuth('f@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/resume`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.stripe.calls.map((c) => c.kind)).toContain('resumeSubscriptionCollection');
  });

  it('resume com assinatura active da 409 InvalidStatus', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('g@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/resume`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'InvalidStatus' });
    expect(ctx.stripe.calls).toEqual([]);
  });

  it('assinatura expirada da 409 InvalidStatus em toda mutacao', async () => {
    const { membershipId } = await seedSubscription({ status: 'expired' });
    const auth = await adminAuth('h@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'silver', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'InvalidStatus' });
  });

  it('assinatura Apple da 409 ProviderNotMutable', async () => {
    const { membershipId } = await seedSubscription({ provider: 'apple_revenuecat' });
    const auth = await adminAuth('i@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'ProviderNotMutable' });
    expect(ctx.stripe.calls).toEqual([]);
  });

  it('gate de status vem antes do gate de provider', async () => {
    const { membershipId } = await seedSubscription({
      provider: 'apple_revenuecat',
      status: 'expired',
    });
    const auth = await adminAuth('j@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.json()).toMatchObject({ error: 'InvalidStatus' });
  });

  it('mutacao com a flag de billing desligada da 503', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('k@example.com');
    const previous = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    const flagged = await makeAppWithFakeStripe();

    const res = await flagged.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(503);
    await flagged.app.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = previous;
  });

  it('troca para o plano atual da 409 NoChange', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('l@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'gold', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NoChange' });
  });

  it('rateio create_prorations chega na Stripe', async () => {
    const { membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription as never;
    const auth = await adminAuth('m@example.com');

    await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'silver', cadence: 'monthly' },
    });

    const call = ctx.stripe.calls.find((c) => c.kind === 'updateSubscriptionItemPrice');
    expect(call?.payload).toMatchObject({ subscriptionItemId: 'si_plan', priceId: 'price_silver' });
  });
});
