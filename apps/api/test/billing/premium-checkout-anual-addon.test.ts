/**
 * Decisao 2 (2026-08-29): anual mais add-on vira rejeicao 422 tipada, nao um
 * 503 generico. PremiumAddonModule so tem stripePriceId mensal, e a Stripe
 * recusa uma sessao de assinatura com intervalos misturados — o modelo prova
 * a incompatibilidade sem round-trip nenhum. Ver checkAnnualCadenceAddonRejection
 * em ../../src/routes/me-premium.ts.
 *
 * Env pattern mirrors premium-checkout-addons.test.ts and me-premium.test.ts:
 * GROWTH_PREMIUM_BILLING_ENABLED and the gold price env vars are process-wide
 * and toggled by other test files, so this file sets and restores them itself
 * to stay deterministic regardless of run order.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const originalMonthly = process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
const originalAnnual = process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  if (originalMonthly === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = originalMonthly;
  if (originalAnnual === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = originalAnnual;
};

describe('POST /api/me/premium/checkout — anual mais add-on', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = 'price_monthly_test';
    process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = 'price_annual_test';
    await resetDatabase();
    await prisma.premiumAddonModule.deleteMany();
    ({ app } = await makeAppWithFakeStripe());
    await prisma.premiumAddonModule.create({
      data: {
        key: 'detail',
        name: 'Detailing',
        description: 'Lavagem mensal',
        monthlyDeltaCents: 9900,
        currency: 'BRL',
        quotaPerCycle: 1,
        quotaUnit: 'access',
        active: true,
        stripePriceId: 'price_addon_detail',
      },
    });
  });

  afterEach(async () => {
    await app.close();
    restoreEnv();
  });

  it('recusa com 422 tipado em vez de 503', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'annual', addonKeys: ['detail'] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'PremiumCheckoutRejected',
      code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
      addonKeys: ['detail'],
    });
  });

  it('nao recusa anual sem add-on', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).not.toBe(422);
    expect(res.statusCode).toBe(201);
  });

  it('nao recusa mensal com add-on', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', addonKeys: ['detail'] },
    });

    expect(res.statusCode).not.toBe(422);
    expect(res.statusCode).toBe(201);
  });
});
