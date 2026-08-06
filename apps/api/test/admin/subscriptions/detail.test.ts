import { prisma } from '@ccc/db';
import { adminSubscriptionDetailSchema } from '@ccc/shared/admin-subscription';
import { loadEnv } from '../../../src/env.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

import { seedSubscription } from './seed.js';

// resetDatabase() deliberately does NOT truncate PremiumPlan, PremiumPlanPrice,
// PremiumAddonModule or PremiumMembershipAddon (see test/helpers.ts). seedSubscription()
// below creates a plan (tier/slug unique) and an addon module (key unique) on every
// call, so without this local reset the second test in this file collides on those
// unique constraints. Pattern mirrors test/billing/premium-catalog.test.ts.
const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

describe('GET /admin/subscriptions/:id', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('401 sem token', async () => {
    const { membershipId } = await seedSubscription();
    const res = await app.inject({ method: 'GET', url: `/admin/subscriptions/${membershipId}` });
    expect(res.statusCode).toBe(401);
  });

  it('403 para role user', async () => {
    const { membershipId } = await seedSubscription();
    const { user: u } = await createUser({ email: 'u@example.com', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), u.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 para role staff', async () => {
    const { membershipId } = await seedSubscription();
    const { user: u } = await createUser({ email: 's@example.com', role: 'staff', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), u.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('devolve o detalhe completo, validado pelo schema', async () => {
    const { membershipId, memberId, garageId } = await seedSubscription();
    const { user: admin } = await createUser({ email: 'a@example.com', role: 'admin', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminSubscriptionDetailSchema.parse(res.json());

    expect(body.membershipId).toBe(membershipId);
    expect(body.userId).toBe(memberId);
    expect(body.userEmail).toBe('membro@example.com');
    expect(body.garageId).toBe(garageId);
    expect(body.planName).toBe('Fundador');
    expect(body.mutable).toBe(true);
    expect(body.paymentBrand).toBe('visa');
    expect(body.totalAmountCents).toBe(164000);

    expect(body.addons).toHaveLength(1);
    const addon = body.addons[0]!;
    expect(addon.vendorName).toBe('Lava Rápido X');
    expect(addon.payoutAmountCents).toBe(9000);
    expect(addon.marginCents).toBe(6000);
    expect(addon.billingIntegrated).toBe(true);
    expect(addon.currentCycle).toMatchObject({ quotaTotal: 3, quotaUsed: 1, quotaRemaining: 2 });

    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]?.grossAmountCents).toBe(164000);
  });

  it('nao vaza referencia de provider', async () => {
    const { membershipId } = await seedSubscription();
    const { user: admin } = await createUser({ email: 'a2@example.com', role: 'admin', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.payload).not.toContain('sub_secreto_1');
    expect(res.payload).not.toContain('si_secreto_1');
    expect(res.payload).not.toContain('cus_1');
  });

  it('assinatura Apple vem com mutable falso', async () => {
    const { membershipId } = await seedSubscription({ provider: 'apple_revenuecat' });
    const { user: admin } = await createUser({ email: 'a3@example.com', role: 'admin', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.json()).toMatchObject({ mutable: false, provider: 'apple_revenuecat' });
  });

  it('404 para id inexistente', async () => {
    const { user: admin } = await createUser({ email: 'a4@example.com', role: 'admin', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/subscriptions/mem_inexistente',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('leitura funciona com a flag de billing desligada', async () => {
    const { membershipId } = await seedSubscription();
    const { user: admin } = await createUser({ email: 'a5@example.com', role: 'admin', verified: true });
    const previous = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    const flaggedApp = await makeApp();

    const res = await flaggedApp.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    await flaggedApp.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = previous;
  });
});
