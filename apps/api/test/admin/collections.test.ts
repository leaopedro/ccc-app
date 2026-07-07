import { prisma } from '@jdm/db';
import {
  adminStoreCollectionDetailSchema,
  adminStoreCollectionListResponseSchema,
  adminStoreCollectionSchema,
} from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const ensureProductType = async () =>
  prisma.productType.upsert({
    where: { name: 'Vestuário' },
    update: {},
    create: { name: 'Vestuário' },
  });

const seedProduct = async (slug: string, status: 'draft' | 'active' | 'archived' = 'active') => {
  const productType = await ensureProductType();
  return prisma.product.create({
    data: {
      slug,
      title: `Produto ${slug}`,
      description: 'Descrição do produto',
      basePriceCents: 5000,
      productTypeId: productType.id,
      status,
    },
  });
};

const orgAuth = async () => {
  const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
  return { user, header: bearer(loadEnv(), user.id, 'organizer') };
};

describe('Admin Store Collections', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /admin/store/collections', () => {
    it('creates a collection and writes audit', async () => {
      const { user, header } = await orgAuth();
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections',
        headers: { authorization: header },
        payload: {
          slug: 'drift-2026',
          name: 'Drift 2026',
          description: 'Coleção da temporada',
          active: true,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = adminStoreCollectionSchema.parse(res.json());
      expect(body.slug).toBe('drift-2026');
      expect(body.name).toBe('Drift 2026');
      expect(body.active).toBe(true);
      expect(body.sortOrder).toBe(0);
      expect(body.productCount).toBe(0);

      const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
      expect(audits.map((a) => a.action)).toContain('store.collection.create');
    });

    it('rejects duplicate slug with 409', async () => {
      const { header } = await orgAuth();
      await prisma.collection.create({
        data: { slug: 'drift-2026', name: 'Drift 2026', sortOrder: 0 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections',
        headers: { authorization: header },
        payload: { slug: 'drift-2026', name: 'Outra' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'SlugTaken' });
    });

    it('rejects malformed slug', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections',
        headers: { authorization: header },
        payload: { slug: 'Drift 2026', name: 'Drift' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('forbids non-organizer users', async () => {
      const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections',
        headers: { authorization: bearer(env, user.id, 'user') },
        payload: { slug: 'drift-2026', name: 'Drift' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /admin/store/collections', () => {
    it('returns collections sorted by sortOrder with product counts', async () => {
      const { header } = await orgAuth();
      const a = await prisma.collection.create({
        data: { slug: 'a', name: 'A', sortOrder: 1 },
      });
      await prisma.collection.create({
        data: { slug: 'b', name: 'B', sortOrder: 0 },
      });
      const product = await seedProduct('p-1');
      await prisma.productCollection.create({
        data: { productId: product.id, collectionId: a.id, sortOrder: 0 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/collections',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreCollectionListResponseSchema.parse(res.json());
      expect(body.items.map((c) => c.slug)).toEqual(['b', 'a']);
      const aRow = body.items.find((c) => c.slug === 'a')!;
      expect(aRow.productCount).toBe(1);
      const bRow = body.items.find((c) => c.slug === 'b')!;
      expect(bRow.productCount).toBe(0);
    });
  });

  describe('PATCH /admin/store/collections/:id', () => {
    it('updates active flag and sortOrder', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({
        data: { slug: 'c1', name: 'C1', active: true, sortOrder: 5 },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/collections/${collection.id}`,
        headers: { authorization: header },
        payload: { active: false, sortOrder: 9 },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreCollectionSchema.parse(res.json());
      expect(body.active).toBe(false);
      expect(body.sortOrder).toBe(9);
    });

    it('clears description with null', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({
        data: { slug: 'c1', name: 'C1', description: 'old' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/collections/${collection.id}`,
        headers: { authorization: header },
        payload: { description: '' },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreCollectionSchema.parse(res.json());
      expect(body.description).toBeNull();
    });

    it('returns 404 for missing collection', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/store/collections/missing',
        headers: { authorization: header },
        payload: { active: false },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 409 on slug collision', async () => {
      const { header } = await orgAuth();
      await prisma.collection.create({ data: { slug: 'taken', name: 'Taken' } });
      const c = await prisma.collection.create({ data: { slug: 'free', name: 'Free' } });
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/collections/${c.id}`,
        headers: { authorization: header },
        payload: { slug: 'taken' },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('DELETE /admin/store/collections/:id', () => {
    it('removes collection and its product joins', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({
        data: { slug: 'gone', name: 'Gone' },
      });
      const product = await seedProduct('p-2');
      await prisma.productCollection.create({
        data: { productId: product.id, collectionId: collection.id, sortOrder: 0 },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/store/collections/${collection.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(204);
      expect(await prisma.collection.count({ where: { id: collection.id } })).toBe(0);
      expect(await prisma.productCollection.count({ where: { collectionId: collection.id } })).toBe(
        0,
      );
      // Product is preserved.
      expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
    });
  });

  describe('POST /admin/store/collections/reorder', () => {
    it('rewrites sortOrder according to id sequence', async () => {
      const { header } = await orgAuth();
      const a = await prisma.collection.create({
        data: { slug: 'a', name: 'A', sortOrder: 0 },
      });
      const b = await prisma.collection.create({
        data: { slug: 'b', name: 'B', sortOrder: 1 },
      });
      const c = await prisma.collection.create({
        data: { slug: 'c', name: 'C', sortOrder: 2 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections/reorder',
        headers: { authorization: header },
        payload: { ids: [c.id, a.id, b.id] },
      });
      expect(res.statusCode).toBe(204);

      const ordered = await prisma.collection.findMany({ orderBy: { sortOrder: 'asc' } });
      expect(ordered.map((row) => row.slug)).toEqual(['c', 'a', 'b']);
      expect(ordered.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
    });

    it('rejects unknown collection id', async () => {
      const { header } = await orgAuth();
      const a = await prisma.collection.create({ data: { slug: 'a', name: 'A' } });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections/reorder',
        headers: { authorization: header },
        payload: { ids: [a.id, 'missing'] },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /admin/store/collections/:id/products', () => {
    it('replaces product set with explicit ordering', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({
        data: { slug: 'col', name: 'Col' },
      });
      const p1 = await seedProduct('p-1');
      const p2 = await seedProduct('p-2');
      const p3 = await seedProduct('p-3');

      // Pre-existing assignment that should be replaced.
      await prisma.productCollection.create({
        data: { productId: p3.id, collectionId: collection.id, sortOrder: 0 },
      });

      const res = await app.inject({
        method: 'PUT',
        url: `/admin/store/collections/${collection.id}/products`,
        headers: { authorization: header },
        payload: { productIds: [p2.id, p1.id] },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreCollectionDetailSchema.parse(res.json());
      expect(body.productCount).toBe(2);
      expect(body.products.map((p) => p.productId)).toEqual([p2.id, p1.id]);
      expect(body.products.map((p) => p.sortOrder)).toEqual([0, 1]);

      const rows = await prisma.productCollection.findMany({
        where: { collectionId: collection.id },
        orderBy: { sortOrder: 'asc' },
      });
      expect(rows.map((row) => row.productId)).toEqual([p2.id, p1.id]);
    });

    it('clears all products when given empty list', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({ data: { slug: 'col', name: 'Col' } });
      const p1 = await seedProduct('p-1');
      await prisma.productCollection.create({
        data: { productId: p1.id, collectionId: collection.id, sortOrder: 0 },
      });

      const res = await app.inject({
        method: 'PUT',
        url: `/admin/store/collections/${collection.id}/products`,
        headers: { authorization: header },
        payload: { productIds: [] },
      });
      expect(res.statusCode).toBe(200);
      expect(await prisma.productCollection.count({ where: { collectionId: collection.id } })).toBe(
        0,
      );
    });

    it('rejects duplicate product ids in the payload', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({ data: { slug: 'col', name: 'Col' } });
      const p1 = await seedProduct('p-1');
      const res = await app.inject({
        method: 'PUT',
        url: `/admin/store/collections/${collection.id}/products`,
        headers: { authorization: header },
        payload: { productIds: [p1.id, p1.id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects unknown product id', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({ data: { slug: 'col', name: 'Col' } });
      const res = await app.inject({
        method: 'PUT',
        url: `/admin/store/collections/${collection.id}/products`,
        headers: { authorization: header },
        payload: { productIds: ['missing'] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unknown collection', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PUT',
        url: '/admin/store/collections/missing/products',
        headers: { authorization: header },
        payload: { productIds: [] },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /admin/store/collections/:id', () => {
    it('returns collection detail with products in sortOrder', async () => {
      const { header } = await orgAuth();
      const collection = await prisma.collection.create({ data: { slug: 'c', name: 'C' } });
      const p1 = await seedProduct('p-1');
      const p2 = await seedProduct('p-2');
      await prisma.productCollection.createMany({
        data: [
          { productId: p1.id, collectionId: collection.id, sortOrder: 1 },
          { productId: p2.id, collectionId: collection.id, sortOrder: 0 },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/store/collections/${collection.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreCollectionDetailSchema.parse(res.json());
      expect(body.products.map((p) => p.productId)).toEqual([p2.id, p1.id]);
      expect(body.productCount).toBe(2);
    });
  });
});
