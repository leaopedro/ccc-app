import { prisma } from '@ccc/db';
import { boxCatalogSchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const CYCLE_KEY = '2026-08-01';

const setupCatalogFixtures = async () => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_cat1',
      providerSubRef: `sub_cat_${user.id}`,
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
  await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: CYCLE_KEY,
      cycleStart: new Date('2026-08-01T00:00:00.000Z'),
      cycleEnd: new Date('2026-08-31T00:00:00.000Z'),
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: 15000,
    },
  });

  // Active item with finite stock, fully reserved (soldOut true).
  const soldOutItem = await prisma.boxCatalogItem.create({
    data: {
      slug: 'sold-out-item',
      title: 'Sold Out Item',
      description: 'A sold out item',
      category: 'Acessorios',
      priceCents: 2000,
      active: true,
      stockPerCycle: 2,
      sortOrder: 1,
    },
  });
  await prisma.boxCatalogItemCycleStock.create({
    data: { catalogItemId: soldOutItem.id, cycleKey: CYCLE_KEY, total: 2, reserved: 2 },
  });

  // Active item with no stock limit (soldOut false).
  const unlimitedItem = await prisma.boxCatalogItem.create({
    data: {
      slug: 'unlimited-item',
      title: 'Unlimited Item',
      description: 'An unlimited item',
      category: 'Bebidas',
      priceCents: 1500,
      active: true,
      stockPerCycle: null,
      sortOrder: 2,
    },
  });

  // Archived item — must be absent from the response.
  const archivedItem = await prisma.boxCatalogItem.create({
    data: {
      slug: 'archived-item',
      title: 'Archived Item',
      description: 'An archived item',
      category: 'Archived',
      priceCents: 500,
      active: false,
      sortOrder: 3,
    },
  });

  // Active partner with one active module.
  const partner = await prisma.partner.create({
    data: {
      slug: 'partner-one',
      name: 'Partner One',
      active: true,
      sortOrder: 1,
      modules: {
        create: {
          name: 'Module Alpha',
          active: true,
          priceCents: 3000,
          sortOrder: 1,
        },
      },
    },
  });

  return { user, soldOutItem, unlimitedItem, archivedItem, partner };
};

describe('GET /me/box/catalog', () => {
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
    const res = await app.inject({ method: 'GET', url: '/me/box/catalog' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a user without an eligible membership', async () => {
    const { user } = await createUser({ verified: true, email: 'nocat@jdm.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/me/box/catalog',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns catalog with correct soldOut flags, excludes archived, includes partners', async () => {
    const { user, soldOutItem, unlimitedItem, archivedItem, partner } =
      await setupCatalogFixtures();

    const res = await app.inject({
      method: 'GET',
      url: '/me/box/catalog',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);

    const catalog = boxCatalogSchema.parse(res.json());

    // Sold-out item.
    const soldOut = catalog.items.find((i) => i.id === soldOutItem.id);
    expect(soldOut).toBeDefined();
    expect(soldOut!.soldOut).toBe(true);

    // Unlimited item.
    const unlimited = catalog.items.find((i) => i.id === unlimitedItem.id);
    expect(unlimited).toBeDefined();
    expect(unlimited!.soldOut).toBe(false);

    // Archived item must be absent.
    const archived = catalog.items.find((i) => i.id === archivedItem.id);
    expect(archived).toBeUndefined();

    // Categories contain active items' categories only.
    expect(catalog.categories).toContain('Acessorios');
    expect(catalog.categories).toContain('Bebidas');
    expect(catalog.categories).not.toContain('Archived');

    // Partner with one module.
    const p = catalog.partners.find((x) => x.id === partner.id);
    expect(p).toBeDefined();
    expect(p!.modules).toHaveLength(1);
  });
});
