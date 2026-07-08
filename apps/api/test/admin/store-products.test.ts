import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
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

const orgAuth = async () => {
  const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
  return bearer(loadEnv(), user.id, 'organizer');
};

describe('PATCH /admin/store/products/:id activation guard', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects activation when product has no photos', async () => {
    const product = await seedDraftProduct('camiseta-azul');
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('draft');
  });

  it('rejects activation when product has photos but no fulfillment method', async () => {
    const product = await seedDraftProduct('camiseta-amarela');
    await prisma.productPhoto.create({
      data: { productId: product.id, objectKey: 'store/products/x/photo.jpg', sortOrder: 0 },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('draft');
  });

  it('allows activation once at least one photo and one fulfillment method exist', async () => {
    const product = await seedDraftProduct('camiseta-verde');
    await prisma.productPhoto.create({
      data: { productId: product.id, objectKey: 'store/products/x/photo.jpg', sortOrder: 0 },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'active', allowPickup: true },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('active');
    expect(refreshed?.allowPickup).toBe(true);
  });

  it('allows non-status edits on a photo-less draft', async () => {
    const product = await seedDraftProduct('camiseta-preta');
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { title: 'Camiseta Preta v2' },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('draft');
    expect(refreshed?.title).toBe('Camiseta Preta v2');
  });

  it('rejects removing both fulfillment methods from an active product', async () => {
    const product = await seedDraftProduct('camiseta-roxa');
    await prisma.productPhoto.create({
      data: { productId: product.id, objectKey: 'store/products/x/photo.jpg', sortOrder: 0 },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { status: 'active', allowPickup: true },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { allowPickup: false },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.allowPickup).toBe(true);
  });

  it('rejects status change on the garage-spot singleton (archive)', async () => {
    const productType = await prisma.productType.upsert({
      where: { name: 'garage_spot' },
      update: {},
      create: { name: 'garage_spot', sortOrder: 99 },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'garage-spot',
        title: 'Vaga de Garagem Adicional',
        description: 'Vaga adicional.',
        basePriceCents: 4900,
        productTypeId: productType.id,
        status: 'active',
        virtual: true,
        visibleInStore: false,
      },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'archived' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('active');
  });

  it('rejects status change on the garage-spot singleton (re-activate from archived)', async () => {
    const productType = await prisma.productType.upsert({
      where: { name: 'garage_spot' },
      update: {},
      create: { name: 'garage_spot', sortOrder: 99 },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'garage-spot',
        title: 'Vaga de Garagem Adicional',
        description: 'Vaga adicional.',
        basePriceCents: 4900,
        productTypeId: productType.id,
        status: 'archived',
        virtual: true,
        visibleInStore: false,
      },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('archived');
  });

  it('rejects productTypeId change on the garage-spot singleton', async () => {
    const productType = await prisma.productType.upsert({
      where: { name: 'garage_spot' },
      update: {},
      create: { name: 'garage_spot', sortOrder: 99 },
    });
    const otherType = await prisma.productType.upsert({
      where: { name: 'Vestuário' },
      update: {},
      create: { name: 'Vestuário' },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'garage-spot',
        title: 'Vaga de Garagem Adicional',
        description: 'Vaga adicional.',
        basePriceCents: 4900,
        productTypeId: productType.id,
        status: 'active',
        virtual: true,
        visibleInStore: false,
      },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { productTypeId: otherType.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.productTypeId).toBe(productType.id);
  });

  it('allows productTypeId echo on the garage-spot singleton (unchanged)', async () => {
    const productType = await prisma.productType.upsert({
      where: { name: 'garage_spot' },
      update: {},
      create: { name: 'garage_spot', sortOrder: 99 },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'garage-spot',
        title: 'Vaga de Garagem Adicional',
        description: 'Vaga adicional.',
        basePriceCents: 4900,
        productTypeId: productType.id,
        status: 'active',
        virtual: true,
        visibleInStore: false,
      },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { productTypeId: productType.id, title: 'Vaga Renomeada' },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.productTypeId).toBe(productType.id);
    expect(refreshed?.title).toBe('Vaga Renomeada');
  });

  it('allows non-status edits on the garage-spot singleton (e.g. price)', async () => {
    const productType = await prisma.productType.upsert({
      where: { name: 'garage_spot' },
      update: {},
      create: { name: 'garage_spot', sortOrder: 99 },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'garage-spot',
        title: 'Vaga de Garagem Adicional',
        description: 'Vaga adicional.',
        basePriceCents: 4900,
        productTypeId: productType.id,
        status: 'active',
        virtual: true,
        visibleInStore: false,
      },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { basePriceCents: 5900 },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.basePriceCents).toBe(5900);
    expect(refreshed?.status).toBe('active');
  });

  it('allows status echo on the garage-spot singleton (status unchanged)', async () => {
    const productType = await prisma.productType.upsert({
      where: { name: 'garage_spot' },
      update: {},
      create: { name: 'garage_spot', sortOrder: 99 },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'garage-spot',
        title: 'Vaga de Garagem Adicional',
        description: 'Vaga adicional.',
        basePriceCents: 4900,
        productTypeId: productType.id,
        status: 'active',
        virtual: true,
        visibleInStore: false,
      },
    });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'active', title: 'Vaga Renomeada' },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.title).toBe('Vaga Renomeada');
    expect(refreshed?.status).toBe('active');
  });

  it('does not re-check the guard when product is already active', async () => {
    const product = await seedDraftProduct('camiseta-rosa');
    const photo = await prisma.productPhoto.create({
      data: { productId: product.id, objectKey: 'store/products/x/p.jpg', sortOrder: 0 },
    });
    await prisma.product.update({ where: { id: product.id }, data: { status: 'active' } });
    await prisma.productPhoto.delete({ where: { id: photo.id } });
    const header = await orgAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: header },
      payload: { status: 'active', title: 'Renomeado' },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUnique({ where: { id: product.id } });
    expect(refreshed?.status).toBe('active');
    expect(refreshed?.title).toBe('Renomeado');
  });
});

describe('GET /admin/store/products/lookup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns id/slug/title/status for every product, regardless of status', async () => {
    const draft = await seedDraftProduct('camiseta-lookup-draft');
    const active = await seedDraftProduct('camiseta-lookup-active');
    await prisma.productPhoto.create({
      data: { productId: active.id, objectKey: 'store/products/x/p.jpg', sortOrder: 0 },
    });
    await prisma.product.update({
      where: { id: active.id },
      data: { status: 'active', allowPickup: true },
    });
    const archived = await seedDraftProduct('camiseta-lookup-archived');
    await prisma.product.update({ where: { id: archived.id }, data: { status: 'archived' } });

    const header = await orgAuth();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/products/lookup',
      headers: { authorization: header },
    });

    expect(res.statusCode).toBe(200);
    const body: {
      items: Array<{ id: string; slug: string; title: string; status: string }>;
    } = res.json();
    const byId = new Map<string, { slug: string; title: string; status: string }>(
      body.items.map((item) => [item.id, item]),
    );
    expect(byId.get(draft.id)).toMatchObject({ slug: 'camiseta-lookup-draft', status: 'draft' });
    expect(byId.get(active.id)).toMatchObject({ slug: 'camiseta-lookup-active', status: 'active' });
    expect(byId.get(archived.id)).toMatchObject({
      slug: 'camiseta-lookup-archived',
      status: 'archived',
    });
  });

  it('requires organizer/admin auth', async () => {
    const app2 = app;
    const res = await app2.inject({ method: 'GET', url: '/admin/store/products/lookup' });
    expect(res.statusCode).toBe(401);
  });
});
