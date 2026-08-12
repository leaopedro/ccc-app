import { prisma } from '@ccc/db';
import { boxHistorySchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setupGarageWithCancelledHistory = async () => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_hist_1',
      providerSubRef: `sub_hist_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'expired',
      currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-06-30T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const olderBox = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-06-01',
      cycleStart: new Date('2026-06-01T00:00:00.000Z'),
      cycleEnd: new Date('2026-06-30T00:00:00.000Z'),
      cutoffAt: new Date('2026-06-26T00:00:00.000Z'),
      budgetCentsSnapshot: 15000,
      status: 'ready',
      chargeCents: 3500,
    },
  });
  const newerBox = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-07-01',
      cycleStart: new Date('2026-07-01T00:00:00.000Z'),
      cycleEnd: new Date('2026-07-31T00:00:00.000Z'),
      cutoffAt: new Date('2026-07-26T00:00:00.000Z'),
      budgetCentsSnapshot: 15000,
      status: 'open',
      chargeCents: 0,
    },
  });
  return { user, olderBox, newerBox };
};

describe('GET /me/boxes', () => {
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
    const res = await app.inject({ method: 'GET', url: '/me/boxes' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty array for user with no boxes', async () => {
    const { user } = await createUser({ verified: true, email: 'noboxes@jdm.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/me/boxes',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(boxHistorySchema.parse(res.json())).toEqual([]);
  });

  it('returns two entries newest-first; cancelled membership does not gate history', async () => {
    const { user, newerBox } = await setupGarageWithCancelledHistory();
    const res = await app.inject({
      method: 'GET',
      url: '/me/boxes',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const history = boxHistorySchema.parse(res.json());
    expect(history).toHaveLength(2);
    expect(history[0]!.id).toBe(newerBox.id);
    expect(history[0]!.current).toBe(true);
    expect(history[1]!.current).toBe(false);
  });
});
