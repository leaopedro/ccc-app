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

  // Active item whose catalog capacity was raised to 10 AFTER the cycle opened,
  // but whose ledger snapshot (total 1) is exhausted. soldOut must follow the
  // ledger snapshot, not the current catalog stockPerCycle.
  const snapshotItem = await prisma.boxCatalogItem.create({
    data: {
      slug: 'snapshot-item',
      title: 'Snapshot Item',
      description: 'Capacity raised after the cycle opened',
      category: 'Acessorios',
      priceCents: 2500,
      active: true,
      stockPerCycle: 10,
      sortOrder: 4,
    },
  });
  await prisma.boxCatalogItemCycleStock.create({
    data: { catalogItemId: snapshotItem.id, cycleKey: CYCLE_KEY, total: 1, reserved: 1 },
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

  return { user, soldOutItem, snapshotItem, unlimitedItem, archivedItem, partner };
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
    const { user, soldOutItem, snapshotItem, unlimitedItem, archivedItem, partner } =
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

    // Snapshot item: ledger total 1 exhausted, even though catalog capacity is now 10.
    const snapshot = catalog.items.find((i) => i.id === snapshotItem.id);
    expect(snapshot).toBeDefined();
    expect(snapshot!.soldOut).toBe(true);

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

const TIER_CYCLE_KEY = '2026-09-01';

const setupTierMember = async (tier: 'bronze' | 'gold', emailSuffix: string) => {
  const { user } = await createUser({ verified: true, email: `tier-${emailSuffix}@jdm.test` });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: `cus_tier_${emailSuffix}`,
      providerSubRef: `sub_tier_${emailSuffix}`,
      tier,
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-30T00:00:00.000Z'),
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
      cycleKey: TIER_CYCLE_KEY,
      cycleStart: new Date('2026-09-01T00:00:00.000Z'),
      cycleEnd: new Date('2026-09-30T00:00:00.000Z'),
      cutoffAt: new Date('2026-09-26T00:00:00.000Z'),
      budgetCentsSnapshot: 15000,
    },
  });

  await prisma.boxCatalogItem.create({
    data: {
      slug: `ungated-${emailSuffix}`,
      title: 'Ungated',
      description: 'No tier restriction',
      category: 'Geral',
      priceCents: 1000,
      active: true,
      sortOrder: 1,
    },
  });
  await prisma.boxCatalogItem.create({
    data: {
      slug: `locked-silver-${emailSuffix}`,
      title: 'LockedSilver',
      description: 'Silver-gated, visible but locked',
      category: 'Geral',
      priceCents: 2000,
      active: true,
      sortOrder: 2,
      minTier: 'silver',
      restrictedDisplay: 'locked',
    },
  });
  await prisma.boxCatalogItem.create({
    data: {
      slug: `hidden-silver-${emailSuffix}`,
      title: 'HiddenSilver',
      description: 'Silver-gated, hidden entirely',
      category: 'secretos',
      priceCents: 3000,
      active: true,
      sortOrder: 3,
      minTier: 'silver',
      restrictedDisplay: 'hidden',
    },
  });

  return { user };
};

describe('tier gating', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('bronze member: ungated visible, silver-locked visible+locked, silver-hidden absent, category dropped', async () => {
    const { user } = await setupTierMember('bronze', 'bronze');
    const res = await app.inject({
      method: 'GET',
      url: '/me/box/catalog',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const catalog = boxCatalogSchema.parse(res.json());

    const ungated = catalog.items.find((i) => i.title === 'Ungated');
    expect(ungated).toMatchObject({ locked: false, minTier: null });

    const locked = catalog.items.find((i) => i.title === 'LockedSilver');
    expect(locked).toMatchObject({ locked: true, minTier: 'silver' });

    expect(catalog.items.find((i) => i.title === 'HiddenSilver')).toBeUndefined();
    expect(catalog.categories).not.toContain('secretos');
  });

  it('gold member: every item present, all unlocked', async () => {
    const { user } = await setupTierMember('gold', 'gold');
    const res = await app.inject({
      method: 'GET',
      url: '/me/box/catalog',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const catalog = boxCatalogSchema.parse(res.json());

    expect(catalog.items.find((i) => i.title === 'Ungated')).toMatchObject({ locked: false });
    expect(catalog.items.find((i) => i.title === 'LockedSilver')).toMatchObject({ locked: false });
    expect(catalog.items.find((i) => i.title === 'HiddenSilver')).toMatchObject({ locked: false });
    expect(catalog.categories).toContain('secretos');
  });
});
