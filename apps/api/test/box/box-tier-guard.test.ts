import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { confirmBox } from '../../src/services/box/confirm.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setup = async (opts: { tier: 'bronze' | 'silver' | 'gold' }) => {
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
      tier: opts.tier,
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
      budgetCentsSnapshot: 10000,
    },
  });
  const silverItem = await prisma.boxCatalogItem.create({
    data: {
      slug: 'silver-only',
      title: 'Silver Only',
      description: 'x',
      priceCents: 3000,
      category: 'sticker',
      minTier: 'silver',
    },
  });
  return { user, garage, membership, box, silverItem };
};

describe('box tier gating write guards', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('selection-save silently drops a below-tier item', async () => {
    const { user, box, silverItem } = await setup({ tier: 'bronze' });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: { authorization: bearer(env, user.id) },
      payload: { items: [{ catalogItemId: silverItem.id, quantity: 1 }], partnerItems: [] },
    });
    expect(res.statusCode).toBe(200);
    const line = await prisma.monthlyBoxItem.findFirst({
      where: { boxId: box.id, catalogItemId: silverItem.id },
    });
    expect(line).toBeNull();
  });

  it('selection-save sweeps a stale below-tier line not referenced by the request', async () => {
    const { user, box, silverItem } = await setup({ tier: 'bronze' });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: silverItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: silverItem.title,
        included: true,
      },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: { authorization: bearer(env, user.id) },
      payload: { items: [], partnerItems: [] },
    });
    expect(res.statusCode).toBe(200);
    const line = await prisma.monthlyBoxItem.findFirst({
      where: { boxId: box.id, catalogItemId: silverItem.id },
    });
    expect(line).toBeNull();
  });

  it('confirm marks an empty box as skipped and creates no Order', async () => {
    const { user, box, silverItem, membership } = await setup({ tier: 'bronze' });
    const line = await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: silverItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: silverItem.title,
        included: true,
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
    const result = await confirmBox({
      userId: user.id,
      membershipId: membership.id,
      shippingAddressId: address.id,
    });
    expect(result.kind).toBe('empty');
    const fresh = await prisma.monthlyBoxItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(fresh.included).toBe(false);
    expect(fresh.dropReason).toBe('tier_restricted');
    const freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(freshBox.status).toBe('skipped');
    const order = await prisma.order.findFirst({ where: { userId: user.id } });
    expect(order).toBeNull();
  });

  it('confirm keeps a mixed box: below-tier line drops, ungated line survives', async () => {
    const { user, box, silverItem, membership } = await setup({ tier: 'bronze' });
    const gatedLine = await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: silverItem.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: silverItem.title,
        included: true,
      },
    });
    const openItem = await prisma.boxCatalogItem.create({
      data: {
        slug: 'open-item',
        title: 'Open Item',
        description: 'x',
        priceCents: 2000,
        category: 'sticker',
      },
    });
    const openLine = await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: openItem.id,
        quantity: 1,
        unitPriceCents: 2000,
        subtotalCents: 2000,
        titleSnapshot: openItem.title,
        included: true,
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
    const result = await confirmBox({
      userId: user.id,
      membershipId: membership.id,
      shippingAddressId: address.id,
    });
    expect(result.kind).toBe('ok');
    const freshGated = await prisma.monthlyBoxItem.findUniqueOrThrow({
      where: { id: gatedLine.id },
    });
    expect(freshGated.included).toBe(false);
    expect(freshGated.dropReason).toBe('tier_restricted');
    const freshOpen = await prisma.monthlyBoxItem.findUniqueOrThrow({ where: { id: openLine.id } });
    expect(freshOpen.included).toBe(true);
    const freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(freshBox.status).not.toBe('skipped');
  });
});
