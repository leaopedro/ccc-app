import { prisma } from '@ccc/db';
import { boxViewSchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('GET /me/box enrichment', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('returns imageUrl, included flag, and dropped lines with reason', async () => {
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
    const item = await prisma.boxCatalogItem.create({
      data: {
        slug: 'x1',
        title: 'Item X',
        description: 'd',
        priceCents: 1000,
        category: 'acessorios',
        imageObjectKey: 'box_item/u/x1.jpg',
      },
    });
    const droppedItem = await prisma.boxCatalogItem.create({
      data: {
        slug: 'x2-dropped',
        title: 'Dropped',
        description: 'd',
        priceCents: 2000,
        category: 'acessorios',
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
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id,
        quantity: 1,
        unitPriceCents: 1000,
        subtotalCents: 1000,
        titleSnapshot: 'Item X',
        included: true,
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: droppedItem.id,
        quantity: 0,
        unitPriceCents: 2000,
        subtotalCents: 0,
        titleSnapshot: 'Dropped',
        included: false,
        dropReason: 'cutoff_budget_only',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const view = boxViewSchema.parse(res.json());
    const included = view.items.find((i) => i.included);
    const dropped = view.items.find((i) => !i.included);
    expect(included?.imageUrl).toContain('box_item/u/x1.jpg');
    expect(dropped?.dropReason).toBe('cutoff_budget_only');
  });
});
