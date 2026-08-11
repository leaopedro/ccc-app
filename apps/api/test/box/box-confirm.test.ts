import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setup = async (opts: { budgetCents: number; shippingFeeCents: number; cep: string }) => {
  await prisma.boxSettings.upsert({
    where: { id: BOX_SETTINGS_SINGLETON_ID },
    update: {
      boxEnabled: true,
      shippingFeeCents: opts.shippingFeeCents,
      freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
    },
    create: {
      id: BOX_SETTINGS_SINGLETON_ID,
      boxEnabled: true,
      shippingFeeCents: opts.shippingFeeCents,
      freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
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
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: opts.budgetCents,
    },
  });
  const item = await prisma.boxCatalogItem.create({
    data: {
      slug: 'adesivo',
      title: 'Adesivo',
      description: 'x',
      priceCents: 3000,
      category: 'sticker',
    },
  });
  await prisma.monthlyBoxItem.create({
    data: {
      boxId: box.id,
      catalogItemId: item.id,
      quantity: 2,
      unitPriceCents: 3000,
      subtotalCents: 6000,
      titleSnapshot: 'Adesivo',
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
      postalCode: opts.cep,
    },
  });
  return { user, box, address };
};

describe('POST /me/box/confirm', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('budget-only + free shipping goes ready without an Order', async () => {
    const { user, box, address } = await setup({
      budgetCents: 10000,
      shippingFeeCents: 1990,
      cep: '81000-000',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/confirm',
      headers: { authorization: bearer(env, user.id) },
      payload: { shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(200);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.status).toBe('ready');
    expect(fresh.orderId).toBeNull();
    expect(fresh.chargeCents).toBe(0);
  });

  it('overflow creates a pending box Order and goes awaiting_payment', async () => {
    const { user, box, address } = await setup({
      budgetCents: 4000,
      shippingFeeCents: 0,
      cep: '81000-000',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/confirm',
      headers: { authorization: bearer(env, user.id) },
      payload: { shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(200);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.status).toBe('awaiting_payment');
    expect(fresh.chargeCents).toBe(2000);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: fresh.orderId! } });
    expect(order.kind).toBe('box');
    expect(order.status).toBe('pending');
    expect(order.devFeePercent).toBe(0);
    expect(order.amountCents).toBe(2000);
  });

  it('second confirm on an already-confirmed box returns 409 and does not create a second Order (Fix C)', async () => {
    const { user, box, address } = await setup({
      budgetCents: 4000,
      shippingFeeCents: 0,
      cep: '81000-000',
    });
    const payload = { shippingAddressId: address.id };
    const auth = { authorization: bearer(env, user.id) };
    // First confirm succeeds.
    const res1 = await app.inject({
      method: 'POST',
      url: '/me/box/confirm',
      headers: auth,
      payload,
    });
    expect(res1.statusCode).toBe(200);
    // Second confirm on an already-confirmed (awaiting_payment) box must be rejected.
    const res2 = await app.inject({
      method: 'POST',
      url: '/me/box/confirm',
      headers: auth,
      payload,
    });
    expect(res2.statusCode).toBe(409);
    // There must be exactly one Order for this box.
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.orderId).not.toBeNull();
    const orderCount = await prisma.order.count({ where: { id: fresh.orderId! } });
    expect(orderCount).toBe(1);
  });

  it('confirm after cutoffAt returns 409 even if status is still open (Fix D)', async () => {
    const { user, address } = await setup({
      budgetCents: 4000,
      shippingFeeCents: 0,
      cep: '81000-000',
    });
    // Manually set cutoffAt to a past date while status remains open.
    const membership = await prisma.premiumMembership.findFirstOrThrow({
      where: {
        garageId: (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id,
      },
    });
    const box = await prisma.monthlyBox.findFirstOrThrow({
      where: { membershipId: membership.id },
      orderBy: { cycleStart: 'desc' },
    });
    await prisma.monthlyBox.update({
      where: { id: box.id },
      data: { cutoffAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/confirm',
      headers: { authorization: bearer(env, user.id) },
      payload: { shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(409);
  });

  it('shipping outside the free region is added to the charge', async () => {
    const { user, box, address } = await setup({
      budgetCents: 10000,
      shippingFeeCents: 1990,
      cep: '90000-000',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/confirm',
      headers: { authorization: bearer(env, user.id) },
      payload: { shippingAddressId: address.id },
    });
    expect(res.statusCode).toBe(200);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.shippingCents).toBe(1990);
    expect(fresh.chargeCents).toBe(1990);
    expect(fresh.status).toBe('awaiting_payment');
  });
});
