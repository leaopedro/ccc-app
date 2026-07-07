import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedProduct = async (opts: { virtual: boolean }) => {
  const pt = await prisma.productType.create({
    data: { name: `t-${Math.random().toString(36).slice(2, 6)}` },
  });
  return prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Vaga',
      description: 'desc',
      productTypeId: pt.id,
      basePriceCents: 1000,
      currency: 'BRL',
      status: 'draft',
      allowPickup: false,
      allowShip: false,
      virtual: opts.virtual,
    },
  });
};

const orgAuth = async () => {
  const { user } = await createUser({
    email: 'org-virtual@jdm.test',
    verified: true,
    role: 'organizer',
  });
  return bearer(env, user.id, 'organizer');
};

describe('PATCH /admin/store/products/:id — virtual product activate (JDMA TASK-C)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('activates a virtual product with no photos and no fulfillment method', async () => {
    const token = await orgAuth();
    const product = await seedProduct({ virtual: true });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.status).toBe('active');
  });

  it('still rejects activating a non-virtual product with no photos', async () => {
    const token = await orgAuth();
    const product = await seedProduct({ virtual: false });
    // Allow some fulfillment method so the failure isolates to the photo check.
    await prisma.product.update({
      where: { id: product.id },
      data: { allowPickup: true },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(400);
    const body: { message?: string } = res.json();
    expect(body.message).toMatch(/photo/);
  });

  it('still rejects activating a non-virtual product with no fulfillment method', async () => {
    const token = await orgAuth();
    const product = await seedProduct({ virtual: false });
    // Add a photo so failure isolates to the fulfillment-method check.
    await prisma.productPhoto.create({
      data: {
        productId: product.id,
        objectKey: `photos/${product.id}/cover.jpg`,
        sortOrder: 0,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(400);
    const body: { message?: string } = res.json();
    expect(body.message).toMatch(/fulfillment method/);
  });
});
