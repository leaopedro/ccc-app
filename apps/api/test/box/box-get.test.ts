import { prisma } from '@ccc/db';
import { boxViewSchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setupMemberWithBox = async () => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: 15000,
    },
  });
  return { user, box };
};

describe('GET /me/box', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/box' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a user without an eligible membership', async () => {
    const { user } = await createUser({ verified: true, email: 'nomember@jdm.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns the current-cycle box view', async () => {
    const { user } = await setupMemberWithBox();
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const view = boxViewSchema.parse(res.json());
    expect(view.budgetCents).toBe(15000);
    expect(view.status).toBe('open');
    expect(view.fulfillmentStatus).toBe('unfulfilled');
  });
});
