import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const futureCutoff = new Date('2099-12-31T00:00:00.000Z');

const setup = async () => {
  await prisma.boxSettings.upsert({
    where: { id: BOX_SETTINGS_SINGLETON_ID },
    update: { boxEnabled: true, shippingFeeCents: 0, freeShippingCepRanges: [] },
    create: {
      id: BOX_SETTINGS_SINGLETON_ID,
      boxEnabled: true,
      shippingFeeCents: 0,
      freeShippingCepRanges: [],
    },
  });
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
      cutoffAt: futureCutoff,
      budgetCentsSnapshot: 10000,
      status: 'open' as never,
    },
  });
  const address = await prisma.shippingAddress.create({
    data: {
      userId: user.id,
      recipientName: 'Fulano',
      line1: 'Rua X',
      number: '10',
      district: 'Centro',
      city: 'Curitiba',
      stateCode: 'PR',
      postalCode: '81000-000',
    },
  });
  return { user, box, address };
};

describe('PUT /me/box/preferences', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('open box + owned address + autoSendOptIn true -> 204 with updated box', async () => {
    const { user, box, address } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { autoSendOptIn: true, shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(204);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.autoSendOptIn).toBe(true);
    expect(fresh.shippingAddressId).toBe(address.id);
  });

  it('non-free region address -> stores shippingCents so the cutoff worker skips unpaid freight', async () => {
    const { user, box, address } = await setup();
    // Fee configured, address CEP not in any free range.
    await prisma.boxSettings.update({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      data: { shippingFeeCents: 1990, freeShippingCepRanges: [] },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { autoSendOptIn: true, shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(204);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.shippingCents).toBe(1990);
  });

  it('free region address -> shippingCents stays 0', async () => {
    const { user, box, address } = await setup();
    await prisma.boxSettings.update({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      data: {
        shippingFeeCents: 1990,
        freeShippingCepRanges: [{ from: '80000-000', to: '82000-000' }],
      },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { autoSendOptIn: true, shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(204);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.shippingCents).toBe(0);
  });

  it('address owned by another user -> 400 bad_address', async () => {
    const { user } = await setup();
    const { user: otherUser } = await createUser({
      verified: true,
      email: 'other@jdm.test',
    });
    const otherAddress = await prisma.shippingAddress.create({
      data: {
        userId: otherUser.id,
        recipientName: 'Outro',
        line1: 'Rua Y',
        number: '20',
        district: 'Bairro',
        city: 'Curitiba',
        stateCode: 'PR',
        postalCode: '81000-000',
      },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { autoSendOptIn: true, shippingAddressId: otherAddress.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_address');
  });

  it('box in awaiting_payment -> 409 box_locked', async () => {
    const { user, box } = await setup();
    await prisma.monthlyBox.update({
      where: { id: box.id },
      data: { status: 'awaiting_payment' as never },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { autoSendOptIn: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_locked');
  });
});
