import { prisma } from '@jdm/db';
import {
  storeCollectionListResponseSchema,
  storeProductDetailResponseSchema,
  storeProductListResponseSchema,
  storeProductTypeListResponseSchema,
} from '@jdm/shared/store';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

const makeProductType = (overrides: Partial<{ name: string; sortOrder: number }> = {}) =>
  prisma.productType.create({
    data: {
      name: overrides.name ?? `Tipo ${Math.random().toString(36).slice(2, 6)}`,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });

const makeCollection = (
  overrides: Partial<{
    slug: string;
    name: string;
    description: string | null;
    active: boolean;
    sortOrder: number;
  }> = {},
) =>
  prisma.collection.create({
    data: {
      slug: overrides.slug ?? `c-${Math.random().toString(36).slice(2, 8)}`,
      name: overrides.name ?? 'Coleção',
      description: overrides.description ?? null,
      active: overrides.active ?? true,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });

type VariantSeed = {
  name?: string;
  priceCents?: number;
  quantityTotal?: number;
  quantitySold?: number;
  active?: boolean;
};

const makeProduct = async (
  productTypeId: string,
  overrides: Partial<{
    slug: string;
    title: string;
    description: string;
    basePriceCents: number;
    status: 'draft' | 'active' | 'archived';
    allowShip: boolean;
    shippingFeeCents: number | null;
    variants: VariantSeed[];
    photos: { objectKey: string; sortOrder: number }[];
    collectionIds: string[];
    createdAt: Date;
  }> = {},
) => {
  const variants = overrides.variants ?? [{}];
  const photos = overrides.photos ?? [
    { objectKey: `products/default/${Math.random().toString(36).slice(2, 8)}.jpg`, sortOrder: 0 },
  ];
  const resolvedShippingFee =
    overrides.shippingFeeCents === undefined ? 0 : overrides.shippingFeeCents;
  const product = await prisma.product.create({
    data: {
      slug: overrides.slug ?? `p-${Math.random().toString(36).slice(2, 8)}`,
      title: overrides.title ?? 'Produto',
      description: overrides.description ?? 'Descrição',
      productTypeId,
      basePriceCents: overrides.basePriceCents ?? 5000,
      status: overrides.status ?? 'active',
      allowShip:
        overrides.allowShip !== undefined ? overrides.allowShip : resolvedShippingFee != null,
      shippingFeeCents: resolvedShippingFee,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      variants: {
        create: variants.map((v, idx) => ({
          name: v.name ?? `Variante ${idx + 1}`,
          priceCents: v.priceCents ?? 5000,
          quantityTotal: v.quantityTotal ?? 10,
          quantitySold: v.quantitySold ?? 0,
          active: v.active ?? true,
          attributes: {},
        })),
      },
      ...(photos.length > 0
        ? {
            photos: {
              create: photos.map((ph) => ({
                objectKey: ph.objectKey,
                sortOrder: ph.sortOrder,
              })),
            },
          }
        : {}),
      ...(overrides.collectionIds
        ? {
            collections: {
              create: overrides.collectionIds.map((collectionId, idx) => ({
                collectionId,
                sortOrder: idx,
              })),
            },
          }
        : {}),
    },
  });
  return product;
};

describe('GET /store/product-types', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns product types that have a visible active product, ordered by sortOrder ASC', async () => {
    const cam = await makeProductType({ name: 'Camisetas', sortOrder: 2 });
    const ade = await makeProductType({ name: 'Adesivos', sortOrder: 0 });
    const bon = await makeProductType({ name: 'Bonés', sortOrder: 1 });

    await makeProduct(cam.id, { slug: 'cam-x' });
    await makeProduct(ade.id, { slug: 'ade-x' });
    await makeProduct(bon.id, { slug: 'bon-x' });

    const res = await app.inject({ method: 'GET', url: '/store/product-types' });
    expect(res.statusCode).toBe(200);
    const body = storeProductTypeListResponseSchema.parse(res.json());
    expect(body.items.map((t) => t.name)).toEqual(['Adesivos', 'Bonés', 'Camisetas']);
    expect(body.items[0]?.slug).toBe('adesivos');
    expect(body.items[1]?.slug).toBe('bones');
  });

  it('omits product types whose only products are hidden (visibleInStore=false)', async () => {
    const visible = await makeProductType({ name: 'Camisetas', sortOrder: 0 });
    const hidden = await makeProductType({ name: 'Interno', sortOrder: 1 });

    await makeProduct(visible.id, { slug: 'cam-vis' });
    const hiddenProduct = await makeProduct(hidden.id, { slug: 'oculto' });
    await prisma.product.update({
      where: { id: hiddenProduct.id },
      data: { visibleInStore: false },
    });

    const res = await app.inject({ method: 'GET', url: '/store/product-types' });
    expect(res.statusCode).toBe(200);
    const body = storeProductTypeListResponseSchema.parse(res.json());
    expect(body.items.map((t) => t.name)).toEqual(['Camisetas']);
  });

  it('omits product types that have no products at all', async () => {
    await makeProductType({ name: 'Vazio', sortOrder: 0 });
    const populated = await makeProductType({ name: 'Cheio', sortOrder: 1 });
    await makeProduct(populated.id, { slug: 'c-1' });

    const res = await app.inject({ method: 'GET', url: '/store/product-types' });
    expect(res.statusCode).toBe(200);
    const body = storeProductTypeListResponseSchema.parse(res.json());
    expect(body.items.map((t) => t.name)).toEqual(['Cheio']);
  });

  it('returns 503 when the store killswitch is off', async () => {
    await prisma.storeSettings.create({
      data: { id: 'store_default', storeEnabled: false },
    });

    const res = await app.inject({ method: 'GET', url: '/store/product-types' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ServiceUnavailable' });
  });
});

describe('GET /store/collections', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns only active collections that contain at least one active product', async () => {
    const type = await makeProductType();
    const visible = await makeCollection({ slug: 'verao', name: 'Verão', sortOrder: 0 });
    await makeCollection({ slug: 'inativa', name: 'Inativa', active: false });
    await makeCollection({ slug: 'sem-produtos', name: 'Sem produtos', sortOrder: 5 });

    await makeProduct(type.id, { collectionIds: [visible.id] });

    const res = await app.inject({ method: 'GET', url: '/store/collections' });
    expect(res.statusCode).toBe(200);
    const body = storeCollectionListResponseSchema.parse(res.json());
    expect(body.items.map((c) => c.slug)).toEqual(['verao']);
    expect(body.items[0]?.productCount).toBe(1);
  });

  it('hides collections whose only members are products without photos', async () => {
    const type = await makeProductType();
    const photoless = await makeCollection({ slug: 'so-rascunhos', name: 'Só rascunhos' });

    await makeProduct(type.id, { slug: 'sem-foto', photos: [], collectionIds: [photoless.id] });

    const res = await app.inject({ method: 'GET', url: '/store/collections' });
    expect(res.statusCode).toBe(200);
    const body = storeCollectionListResponseSchema.parse(res.json());
    expect(body.items.map((c) => c.slug)).toEqual([]);
  });
});

describe('GET /store/products', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists only active products with at least one active variant', async () => {
    const type = await makeProductType({ name: 'Camisetas' });
    await makeProduct(type.id, { slug: 'visivel', title: 'Visível' });
    await makeProduct(type.id, { slug: 'rascunho', title: 'Rascunho', status: 'draft' });
    await makeProduct(type.id, { slug: 'arquivado', title: 'Arquivado', status: 'archived' });
    await makeProduct(type.id, {
      slug: 'sem-variante-ativa',
      title: 'Sem variante ativa',
      variants: [{ active: false }],
    });

    const res = await app.inject({ method: 'GET', url: '/store/products' });
    expect(res.statusCode).toBe(200);
    const body = storeProductListResponseSchema.parse(res.json());
    expect(body.items.map((p) => p.slug)).toEqual(['visivel']);
    expect(body.nextCursor).toBeNull();
  });

  it('hides active products that have zero photos', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, {
      slug: 'com-foto',
      photos: [{ objectKey: 'products/com-foto/0.jpg', sortOrder: 0 }],
    });
    await makeProduct(type.id, { slug: 'sem-foto', photos: [] });

    const res = await app.inject({ method: 'GET', url: '/store/products' });
    expect(res.statusCode).toBe(200);
    const body = storeProductListResponseSchema.parse(res.json());
    expect(body.items.map((p) => p.slug)).toEqual(['com-foto']);
  });

  it('hides products flagged visibleInStore=false (e.g. virtual singletons)', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, { slug: 'publico', title: 'Público' });
    const hidden = await makeProduct(type.id, { slug: 'oculto', title: 'Oculto' });
    await prisma.product.update({
      where: { id: hidden.id },
      data: { visibleInStore: false },
    });

    const res = await app.inject({ method: 'GET', url: '/store/products' });
    expect(res.statusCode).toBe(200);
    const body = storeProductListResponseSchema.parse(res.json());
    expect(body.items.map((p) => p.slug)).toEqual(['publico']);
  });

  it('filters by collectionSlug and ignores disabled collections', async () => {
    const type = await makeProductType();
    const active = await makeCollection({ slug: 'destaque', name: 'Destaque' });
    const inactive = await makeCollection({ slug: 'oculta', name: 'Oculta', active: false });

    await makeProduct(type.id, { slug: 'a', collectionIds: [active.id] });
    await makeProduct(type.id, { slug: 'b' });
    await makeProduct(type.id, { slug: 'c', collectionIds: [inactive.id] });

    const inActive = await app.inject({
      method: 'GET',
      url: '/store/products?collectionSlug=destaque',
    });
    expect(inActive.statusCode).toBe(200);
    expect(storeProductListResponseSchema.parse(inActive.json()).items.map((p) => p.slug)).toEqual([
      'a',
    ]);

    const inInactive = await app.inject({
      method: 'GET',
      url: '/store/products?collectionSlug=oculta',
    });
    expect(storeProductListResponseSchema.parse(inInactive.json()).items).toHaveLength(0);
  });

  it('filters by productTypeSlug derived from name', async () => {
    const camisetas = await makeProductType({ name: 'Camisetas' });
    const adesivos = await makeProductType({ name: 'Adesivos' });

    await makeProduct(camisetas.id, { slug: 'cam-1' });
    await makeProduct(adesivos.id, { slug: 'ade-1' });

    const res = await app.inject({
      method: 'GET',
      url: '/store/products?productTypeSlug=adesivos',
    });
    const body = storeProductListResponseSchema.parse(res.json());
    expect(body.items.map((p) => p.slug)).toEqual(['ade-1']);
  });

  it('searches by q across title and description (case-insensitive)', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, { slug: 'p1', title: 'Camiseta JDM Vermelha' });
    await makeProduct(type.id, { slug: 'p2', title: 'Boné', description: 'Modelo JDM clássico' });
    await makeProduct(type.id, { slug: 'p3', title: 'Adesivo', description: 'sem relação' });

    const res = await app.inject({ method: 'GET', url: '/store/products?q=jdm' });
    const body = storeProductListResponseSchema.parse(res.json());
    expect(body.items.map((p) => p.slug).sort()).toEqual(['p1', 'p2']);
  });

  it('filters inStock=true to products with at least one variant having remaining stock', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, {
      slug: 'in-stock',
      variants: [{ quantityTotal: 5, quantitySold: 0 }],
    });
    await makeProduct(type.id, {
      slug: 'sold-out',
      variants: [{ quantityTotal: 5, quantitySold: 5 }],
    });

    const res = await app.inject({ method: 'GET', url: '/store/products?inStock=true' });
    const body = storeProductListResponseSchema.parse(res.json());
    expect(body.items.map((p) => p.slug)).toEqual(['in-stock']);
    expect(body.items[0]?.inStock).toBe(true);
  });

  it('keeps paginating until it finds enough in-stock items', async () => {
    const type = await makeProductType();
    const t0 = Date.now();
    await makeProduct(type.id, {
      slug: 'fresh-1',
      createdAt: new Date(t0 - 10_000),
      variants: [{ quantityTotal: 5, quantitySold: 0 }],
    });
    await makeProduct(type.id, {
      slug: 'sold-1',
      createdAt: new Date(t0 - 20_000),
      variants: [{ quantityTotal: 5, quantitySold: 5 }],
    });
    await makeProduct(type.id, {
      slug: 'sold-2',
      createdAt: new Date(t0 - 30_000),
      variants: [{ quantityTotal: 5, quantitySold: 5 }],
    });
    await makeProduct(type.id, {
      slug: 'fresh-2',
      createdAt: new Date(t0 - 40_000),
      variants: [{ quantityTotal: 5, quantitySold: 0 }],
    });

    const page1 = await app.inject({
      method: 'GET',
      url: '/store/products?inStock=true&limit=1',
    });
    expect(page1.statusCode).toBe(200);
    const body1 = storeProductListResponseSchema.parse(page1.json());
    expect(body1.items.map((p) => p.slug)).toEqual(['fresh-1']);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: 'GET',
      url: `/store/products?inStock=true&limit=1&cursor=${encodeURIComponent(body1.nextCursor ?? '')}`,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = storeProductListResponseSchema.parse(page2.json());
    expect(body2.items.map((p) => p.slug)).toEqual(['fresh-2']);
    expect(body2.nextCursor).toBeNull();
  });

  it('sorts price_asc and price_desc by basePriceCents', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, { slug: 'mid', basePriceCents: 5000 });
    await makeProduct(type.id, { slug: 'low', basePriceCents: 1000 });
    await makeProduct(type.id, { slug: 'high', basePriceCents: 9000 });

    const asc = await app.inject({ method: 'GET', url: '/store/products?sort=price_asc' });
    expect(storeProductListResponseSchema.parse(asc.json()).items.map((p) => p.slug)).toEqual([
      'low',
      'mid',
      'high',
    ]);

    const desc = await app.inject({ method: 'GET', url: '/store/products?sort=price_desc' });
    expect(storeProductListResponseSchema.parse(desc.json()).items.map((p) => p.slug)).toEqual([
      'high',
      'mid',
      'low',
    ]);
  });

  it('paginates via cursor and limit (newest order)', async () => {
    const type = await makeProductType();
    const t0 = Date.now();
    await makeProduct(type.id, { slug: 'p-old', createdAt: new Date(t0 - 30_000) });
    await makeProduct(type.id, { slug: 'p-mid', createdAt: new Date(t0 - 20_000) });
    await makeProduct(type.id, { slug: 'p-new', createdAt: new Date(t0 - 10_000) });

    const page1 = await app.inject({ method: 'GET', url: '/store/products?limit=2' });
    const body1 = storeProductListResponseSchema.parse(page1.json());
    expect(body1.items.map((p) => p.slug)).toEqual(['p-new', 'p-mid']);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: 'GET',
      url: `/store/products?limit=2&cursor=${encodeURIComponent(body1.nextCursor ?? '')}`,
    });
    const body2 = storeProductListResponseSchema.parse(page2.json());
    expect(body2.items.map((p) => p.slug)).toEqual(['p-old']);
    expect(body2.nextCursor).toBeNull();
  });
});

describe('GET /store/products/:slug', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns product detail with variants, gallery, and active collections', async () => {
    const type = await makeProductType({ name: 'Camisetas' });
    const visible = await makeCollection({ slug: 'verao', name: 'Verão' });
    const hidden = await makeCollection({ slug: 'arquivada', name: 'Arquivada', active: false });

    await makeProduct(type.id, {
      slug: 'cam-jdm',
      title: 'Camiseta JDM',
      description: 'Algodão pima',
      basePriceCents: 8000,
      shippingFeeCents: 1500,
      variants: [
        { name: 'P', priceCents: 8000, quantityTotal: 5, quantitySold: 1 },
        { name: 'M', priceCents: 8000, quantityTotal: 5, quantitySold: 5 },
      ],
      photos: [
        { objectKey: 'products/cam-jdm/0.jpg', sortOrder: 0 },
        { objectKey: 'products/cam-jdm/1.jpg', sortOrder: 1 },
      ],
      collectionIds: [visible.id, hidden.id],
    });

    const res = await app.inject({ method: 'GET', url: '/store/products/cam-jdm' });
    expect(res.statusCode).toBe(200);
    const body = storeProductDetailResponseSchema.parse(res.json());
    expect(body.product.slug).toBe('cam-jdm');
    expect(body.product.canShip).toBe(true);
    expect(body.product.canPickup).toBe(false);
    expect(body.product.variants.map((v) => v.title)).toEqual(['P', 'M']);
    expect(body.product.variants[0]?.stockOnHand).toBe(4);
    expect(body.product.variants[1]?.stockOnHand).toBe(0);
    expect(body.product.images).toHaveLength(2);
    expect(body.product.images[0]?.sortOrder).toBe(0);
    expect(body.product.collectionIds).toContain(visible.id);
    expect(body.collections.map((c) => c.slug)).toEqual(['verao']);
  });

  it('returns 404 for non-active products', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, { slug: 'rascunho', status: 'draft' });

    const res = await app.inject({ method: 'GET', url: '/store/products/rascunho' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/store/products/inexistente' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for active products with zero photos', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, { slug: 'sem-foto', photos: [] });

    const res = await app.inject({ method: 'GET', url: '/store/products/sem-foto' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for products flagged visibleInStore=false', async () => {
    const type = await makeProductType();
    const hidden = await makeProduct(type.id, { slug: 'oculto' });
    await prisma.product.update({
      where: { id: hidden.id },
      data: { visibleInStore: false },
    });

    const res = await app.inject({ method: 'GET', url: '/store/products/oculto' });
    expect(res.statusCode).toBe(404);
  });

  it('blocks all public storefront reads when the store killswitch is off', async () => {
    const type = await makeProductType();
    await makeProduct(type.id, { slug: 'cam-jdm' });
    await prisma.storeSettings.create({
      data: { id: 'store_default', storeEnabled: false },
    });

    for (const url of ['/store/collections', '/store/products', '/store/products/cam-jdm']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(503);
      expect(res.json()).toMatchObject({ error: 'ServiceUnavailable' });
    }
  });
});
