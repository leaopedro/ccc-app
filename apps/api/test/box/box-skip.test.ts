import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setupMemberWithBox = async (opts: { cutoffAt?: Date; status?: string } = {}) => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_skip1',
      providerSubRef: `sub_skip_${user.id}`,
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
  const cutoffAt = opts.cutoffAt ?? new Date('2026-08-26T00:00:00.000Z');
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt,
      budgetCentsSnapshot: 15000,
      status:
        (opts.status as 'open' | 'skipped' | 'awaiting_payment' | 'ready' | 'cancelled') ?? 'open',
    },
  });
  return { user, box, membership };
};

describe('POST /me/box/skip and /me/box/unskip', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('skip an open box -> 204, status becomes skipped, selection rows preserved', async () => {
    const { user, box } = await setupMemberWithBox();

    // Create a catalog item and a selection row to verify preservation.
    const catalogItem = await prisma.boxCatalogItem.create({
      data: {
        slug: 'produto-teste-skip',
        title: 'Produto Teste',
        description: 'Desc',
        category: 'acessorio',
        priceCents: 1000,
        currency: 'BRL',
        active: true,
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: catalogItem.id,
        quantity: 1,
        unitPriceCents: 1000,
        subtotalCents: 1000,
        titleSnapshot: 'Produto Teste',
        currency: 'BRL',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/box/skip',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);

    const updated = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(updated.status).toBe('skipped');

    const items = await prisma.monthlyBoxItem.findMany({ where: { boxId: box.id } });
    expect(items).toHaveLength(1);
  });

  it('unskip a skipped box -> 204, status becomes open', async () => {
    const { user, box } = await setupMemberWithBox({ status: 'skipped' });

    const res = await app.inject({
      method: 'POST',
      url: '/me/box/unskip',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);

    const updated = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(updated.status).toBe('open');
  });

  it('skip when box is awaiting_payment -> 409 box_locked', async () => {
    const { user } = await setupMemberWithBox({ status: 'awaiting_payment' });

    const res = await app.inject({
      method: 'POST',
      url: '/me/box/skip',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_locked');
  });

  it('unskip a skipped box past cutoffAt -> 409 box_locked', async () => {
    const pastCutoff = new Date('2026-07-01T00:00:00.000Z');
    const { user } = await setupMemberWithBox({ status: 'skipped', cutoffAt: pastCutoff });

    const res = await app.inject({
      method: 'POST',
      url: '/me/box/unskip',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_locked');
  });
});
