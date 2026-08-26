import { prisma } from '@ccc/db';
import { boxViewSchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import { futureCutoff } from './cutoff.js';

const env = loadEnv();

const setup = async () => {
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
      cutoffAt: futureCutoff(),
      budgetCentsSnapshot: 10000,
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
  return { user, box, item };
};

describe('PUT /me/box/selection', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('adds an item and recomputes totals', async () => {
    const { user, item } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: { authorization: bearer(env, user.id) },
      payload: { items: [{ catalogItemId: item.id, quantity: 2 }], partnerItems: [] },
    });
    expect(res.statusCode).toBe(200);
    const view = boxViewSchema.parse(res.json());
    expect(view.itemsTotalCents).toBe(6000);
    expect(view.overflowCents).toBe(0);
    expect(view.chargeCents).toBe(0);
    expect(view.items[0]?.quantity).toBe(2);
  });

  it('quantity 0 removes the line', async () => {
    const { user, item } = await setup();
    const auth = { authorization: bearer(env, user.id) };
    await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: auth,
      payload: { items: [{ catalogItemId: item.id, quantity: 2 }], partnerItems: [] },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: auth,
      payload: { items: [{ catalogItemId: item.id, quantity: 0 }], partnerItems: [] },
    });
    const view = boxViewSchema.parse(res.json());
    expect(view.items).toHaveLength(0);
    expect(view.itemsTotalCents).toBe(0);
  });

  it('409 when the box is not open', async () => {
    const { user, box, item } = await setup();
    await prisma.monthlyBox.update({ where: { id: box.id }, data: { status: 'ready' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: { authorization: bearer(env, user.id) },
      payload: { items: [{ catalogItemId: item.id, quantity: 1 }], partnerItems: [] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('409 when cutoffAt is in the past even if status is still open (Fix E)', async () => {
    const { user, box, item } = await setup();
    // Set cutoffAt to past while keeping status open.
    await prisma.monthlyBox.update({
      where: { id: box.id },
      data: { cutoffAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: { authorization: bearer(env, user.id) },
      payload: { items: [{ catalogItemId: item.id, quantity: 1 }], partnerItems: [] },
    });
    expect(res.statusCode).toBe(409);
    // No line must have been written.
    const lines = await prisma.monthlyBoxItem.findMany({ where: { boxId: box.id } });
    expect(lines).toHaveLength(0);
  });

  it('422 max_per_cycle_exceeded when quantity exceeds maxPerCycle (Fix E)', async () => {
    const { user, box } = await setup();
    // Create a catalog item with maxPerCycle=1.
    const limitedItem = await prisma.boxCatalogItem.create({
      data: {
        slug: 'limited',
        title: 'Limited',
        description: 'x',
        priceCents: 2000,
        category: 'sticker',
        maxPerCycle: 1,
      },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/me/box/selection',
      headers: { authorization: bearer(env, user.id) },
      payload: { items: [{ catalogItemId: limitedItem.id, quantity: 3 }], partnerItems: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('max_per_cycle_exceeded');
    expect(res.json().max).toBe(1);
    // No line must have been written.
    const lines = await prisma.monthlyBoxItem.findMany({ where: { boxId: box.id } });
    expect(lines).toHaveLength(0);
  });
});
