/**
 * LIVE_STATUSES unificada (task 1, plan pagamentos-nativos).
 *
 * Verifies the shared LIVE_MEMBERSHIP_STATUSES constant now blocks a second
 * subscription for `trialing` and `paused` memberships at the precheck route,
 * closing the hole where the three old local copies omitted both statuses.
 *
 * Setup mirrors me-premium.test.ts: buildApp(loadEnv()) with the billing flag
 * toggled via process.env before each loadEnv() call, restored in afterEach.
 */

import { prisma } from '@ccc/db';
import { LIVE_MEMBERSHIP_STATUSES } from '@ccc/shared/premium';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

const PORTAL_URL = 'https://billing.stripe.com/session/mock';

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
};

const buildPremiumApp = async (): Promise<FastifyInstance> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
  const stripe = buildFakeStripe();
  stripe.nextBillingPortalSession = { url: PORTAL_URL };
  return buildApp(loadEnv(), { stripe });
};

const seedMembership = async (garageId: string, status: 'trialing' | 'paused') =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${status}`,
      providerSubRef: `sub_${status}`,
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      baseAmountCents: 24_990,
      devFeePercent: 10,
      devFeeAmountCents: 2499,
      grossAmountCents: 27_489,
      currency: 'BRL',
    },
  });

describe('LIVE_STATUSES unificada', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    restoreEnv();
  });

  it('exporta os cinco estados vivos', () => {
    expect(LIVE_MEMBERSHIP_STATUSES).toHaveLength(5);
  });

  it('trata trialing como assinatura viva na precheck', async () => {
    app = await buildPremiumApp();
    const env = loadEnv();
    const { user } = await createUser({ email: 'trialing@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'trialing');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('AlreadySubscribed');
  });

  it('trata paused como assinatura viva na precheck', async () => {
    app = await buildPremiumApp();
    const env = loadEnv();
    const { user } = await createUser({ email: 'paused@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'paused');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('AlreadySubscribed');
  });
});
