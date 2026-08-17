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

  it('confirm drops a persisted below-tier line as tier_restricted', async () => {
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
    expect(result.kind).toBe('ok');
    const fresh = await prisma.monthlyBoxItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(fresh.included).toBe(false);
    expect(fresh.dropReason).toBe('tier_restricted');
  });
});
