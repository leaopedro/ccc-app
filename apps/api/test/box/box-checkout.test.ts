import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { bearer, createUser, makeAppWithFakes, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seed = async (opts: { cutoffAt: Date; chargeCents: number }) => {
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
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: opts.chargeCents,
      baseAmountCents: opts.chargeCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      status: 'pending',
      shippingCents: 0,
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: opts.cutoffAt,
      budgetCentsSnapshot: 10000,
      status: 'awaiting_payment',
      orderId: order.id,
      chargeCents: opts.chargeCents,
    },
  });
  return { user, order, box };
};

describe('POST /me/box/checkout', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;
  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true },
      create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, shippingFeeCents: 0 },
    });
    ({ app, abacatepay } = await makeAppWithFakes());
  });
  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const future = new Date(Date.now() + 3 * 24 * 3600_000);

  it('creates a Pix billing, stamps the order, returns the brCode', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBilling = {
      id: 'pix_char_1',
      brCode: '00020126-BR',
      amount: 2000,
      expiresAt: future.toISOString(),
      status: 'PENDING',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().brCode).toBe('00020126-BR');
    expect(res.json().amountCents).toBe(2000);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.providerRef).toBe('pix_char_1');
    expect(fresh.brCode).toBe('00020126-BR');
    const createCalls = abacatepay.calls.filter((c) => c.method === 'createPixBilling');
    expect(createCalls).toHaveLength(1);
    expect(
      (createCalls[0]!.args[0] as { metadata?: Record<string, string> }).metadata?.orderId,
    ).toBe(order.id);
  });

  it('reuses the active billing on a second call (idempotent, no duplicate)', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBilling = {
      id: 'pix_char_1',
      brCode: '00020126-BR',
      amount: 2000,
      expiresAt: future.toISOString(),
      status: 'PENDING',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(first.json().brCode).toBe(second.json().brCode);
    expect(abacatepay.calls.filter((c) => c.method === 'createPixBilling')).toHaveLength(1);
  });

  it('409 box_locked when past cutoff', async () => {
    const { user } = await seed({ cutoffAt: new Date(Date.now() - 1000), chargeCents: 2000 });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_locked');
  });

  it('409 box_not_awaiting when the box is not awaiting_payment', async () => {
    const { user, box } = await seed({ cutoffAt: future, chargeCents: 2000 });
    await prisma.monthlyBox.update({ where: { id: box.id }, data: { status: 'ready' } });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_not_awaiting');
  });

  it('502 when AbacatePay upstream fails, leaving the order unstamped', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBillingError = new Error('upstream down');
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(502);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.providerRef).toBeNull();
  });
});
