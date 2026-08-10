import { prisma } from '@ccc/db';
import { adminBoxCatalogItemSchema, adminBoxCatalogListSchema } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const auth = async (role: 'organizer' | 'staff') => {
  const { user } = await createUser({
    email: `${role}-${Date.now()}@jdm-test.local`,
    name: role,
    verified: true,
    role,
  });
  return bearer(env, user.id, role);
};

describe('admin box catalog', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects staff with 403', async () => {
    const header = await auth('staff');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates, lists, updates, and soft-deletes an item', async () => {
    const header = await auth('organizer');

    const create = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: {
        slug: 'cafe-500g',
        title: 'Cafe 500g',
        description: 'Cafe especial',
        priceCents: 4500,
        category: 'bebidas',
      },
    });
    expect(create.statusCode).toBe(201);
    const created = adminBoxCatalogItemSchema.parse(create.json());
    expect(created.active).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
    });
    expect(list.statusCode).toBe(200);
    expect(adminBoxCatalogListSchema.parse(list.json()).items).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/box/catalog-items/${created.id}`,
      headers: { authorization: header },
      payload: { priceCents: 5000 },
    });
    expect(patch.statusCode).toBe(200);
    expect(adminBoxCatalogItemSchema.parse(patch.json()).priceCents).toBe(5000);

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/box/catalog-items/${created.id}`,
      headers: { authorization: header },
    });
    expect(del.statusCode).toBe(200);
    expect(adminBoxCatalogItemSchema.parse(del.json()).active).toBe(false);
  });

  it('rejects duplicate slug with 409', async () => {
    const header = await auth('organizer');
    await prisma.boxCatalogItem.create({
      data: { slug: 'dup', title: 'x', description: 'x', priceCents: 1, category: 'c' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: { slug: 'dup', title: 'y', description: 'y', priceCents: 2, category: 'c' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects invalid body with 422', async () => {
    const header = await auth('organizer');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: { slug: 'bad', title: 'x', description: 'x', priceCents: -1, category: 'c' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('builds imageUrl from a valid box_item key', async () => {
    const header = await auth('organizer');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: {
        slug: 'com-imagem',
        title: 'Com imagem',
        description: 'x',
        priceCents: 1000,
        category: 'c',
        imageObjectKey: 'box_item/some-user/abc.jpg',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = adminBoxCatalogItemSchema.parse(res.json());
    expect(created.imageObjectKey).toBe('box_item/some-user/abc.jpg');
    expect(created.imageUrl).toContain('box_item/some-user/abc.jpg');
  });

  it('rejects a wrong-kind image key with 400', async () => {
    const header = await auth('organizer');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: {
        slug: 'chave-errada',
        title: 'x',
        description: 'x',
        priceCents: 1000,
        category: 'c',
        imageObjectKey: 'product_photo/some-user/abc.jpg',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
