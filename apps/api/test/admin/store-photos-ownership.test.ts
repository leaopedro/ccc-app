import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as deletionQueue from '../../src/services/uploads/deletion-queue.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedProductType = async () =>
  prisma.productType.upsert({
    where: { name: 'Vestuário' },
    update: {},
    create: { name: 'Vestuário' },
  });

const seedDraftProduct = async (slug: string) => {
  const productType = await seedProductType();
  return prisma.product.create({
    data: {
      slug,
      title: `Produto ${slug}`,
      description: 'Descrição',
      basePriceCents: 5000,
      productTypeId: productType.id,
      status: 'draft',
    },
  });
};

describe('POST /admin/store/products/:productId/photos ownership', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('rejects product photo objectKey not owned by the admin user', async () => {
    const { user } = await createUser({ verified: true, role: 'organizer' });
    const env = loadEnv();
    const token = bearer(env, user.id, 'organizer');
    const product = await seedDraftProduct('camiseta-ownership-test');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/store/products/${product.id}/photos`,
      headers: { authorization: token },
      payload: { objectKey: 'product_photo/other-user-id/foreign.jpg', sortOrder: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
  });

  it('accepts product photo objectKey owned by the admin user', async () => {
    const { user } = await createUser({ verified: true, role: 'organizer' });
    const env = loadEnv();
    const token = bearer(env, user.id, 'organizer');
    const product = await seedDraftProduct('camiseta-ownership-ok');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/store/products/${product.id}/photos`,
      headers: { authorization: token },
      payload: { objectKey: `product_photo/${user.id}/photo.jpg`, sortOrder: 0 },
    });

    expect(res.statusCode).toBe(201);
  });

  it('keeps 204 when queue write fails after deleting product photo', async () => {
    const { user } = await createUser({ verified: true, role: 'organizer' });
    const env = loadEnv();
    const token = bearer(env, user.id, 'organizer');
    const product = await seedDraftProduct('camiseta-delete-queue-fail');
    const photo = await prisma.productPhoto.create({
      data: {
        productId: product.id,
        objectKey: `product_photo/${user.id}/to-delete.jpg`,
        sortOrder: 0,
      },
    });

    vi.spyOn(deletionQueue, 'queueObjectDeletion').mockRejectedValueOnce(new Error('queue down'));

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/store/products/${product.id}/photos/${photo.id}`,
      headers: { authorization: token },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.productPhoto.findUnique({ where: { id: photo.id } })).toBeNull();
  });
});
