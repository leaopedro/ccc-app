import { prisma } from '@jdm/db';
import { adminStoreInventoryListResponseSchema } from '@jdm/shared/admin';
import { STORE_SETTINGS_SINGLETON_ID } from '@jdm/shared/store';
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
      description: 'Descrição',
      basePriceCents: 5000,
      productTypeId: productType.id,
      status,
    },
  });
};

const seedVariant = async (
  productId: string,
  overrides: Partial<{
    name: string;
    sku: string | null;
    quantityTotal: number;
    quantitySold: number;
    active: boolean;
  }> = {},
) =>
  prisma.variant.create({
    data: {
      productId,
      name: overrides.name ?? 'Padrão',
      sku: overrides.sku ?? null,
      priceCents: 5000,
      quantityTotal: overrides.quantityTotal ?? 10,
      quantitySold: overrides.quantitySold ?? 0,
      attributes: {},
      active: overrides.active ?? true,
    },
  });

const setThreshold = async (n: number) => {
  await prisma.storeSettings.upsert({
    where: { id: STORE_SETTINGS_SINGLETON_ID },
    update: { lowStockThreshold: n },
    create: { id: STORE_SETTINGS_SINGLETON_ID, lowStockThreshold: n },
  });
};

const orgAuth = async () => {
  const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
  return { user, header: bearer(loadEnv(), user.id, 'organizer') };
};

describe('GET /admin/store/inventory', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('classifies variants by lowStockThreshold and excludes archived products', async () => {
    await setThreshold(3);
    const active = await seedProduct('cap-active');
    const archived = await seedProduct('cap-old', 'archived');
    const draft = await seedProduct('cap-draft', 'draft');

    await seedVariant(active.id, { name: 'OK', quantityTotal: 10, quantitySold: 1 }); // available 9
    await seedVariant(active.id, { name: 'Baixo', quantityTotal: 5, quantitySold: 3 }); // available 2
    await seedVariant(active.id, { name: 'Esgotado', quantityTotal: 4, quantitySold: 4 }); // available 0
    await seedVariant(draft.id, { name: 'Draft baixo', quantityTotal: 3, quantitySold: 1 }); // available 2 → low
    await seedVariant(archived.id, { name: 'Arquivado', quantityTotal: 0, quantitySold: 0 });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/inventory',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(200);
    const body = adminStoreInventoryListResponseSchema.parse(res.json());
    expect(body.threshold).toBe(3);
    expect(body.totals).toEqual({ all: 4, ok: 1, low: 2, zero: 1 });
    expect(body.items.map((i) => i.variantName)).not.toContain('Arquivado');
    expect(body.items[0]!.status).toBe('zero');
    const statuses = body.items.map((i) => `${i.variantName}:${i.status}`);
    expect(statuses).toContain('OK:ok');
    expect(statuses).toContain('Baixo:low');
    expect(statuses).toContain('Draft baixo:low');
  });

  it('filters by status=low', async () => {
    await setThreshold(5);
    const product = await seedProduct('p');
    await seedVariant(product.id, { name: 'OK', quantityTotal: 50, quantitySold: 0 });
    await seedVariant(product.id, { name: 'Baixo', quantityTotal: 5, quantitySold: 1 });
    await seedVariant(product.id, { name: 'Zero', quantityTotal: 1, quantitySold: 1 });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/inventory?status=low',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(200);
    const body = adminStoreInventoryListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.variantName).toBe('Baixo');
    expect(body.totals).toEqual({ all: 3, ok: 1, low: 1, zero: 1 });
  });

  it('filters by status=zero', async () => {
    await setThreshold(5);
    const product = await seedProduct('p');
    await seedVariant(product.id, { name: 'OK', quantityTotal: 50, quantitySold: 0 });
    await seedVariant(product.id, { name: 'Esgotado', quantityTotal: 2, quantitySold: 2 });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/inventory?status=zero',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(200);
    const body = adminStoreInventoryListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.status).toBe('zero');
  });

  it('rejects unknown status filter', async () => {
    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/inventory?status=bogus',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects staff role', async () => {
    const { user } = await createUser({ email: 'staff@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/inventory',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/store/inventory' });
    expect(res.statusCode).toBe(401);
  });

  it('sorts by available ascending', async () => {
    await setThreshold(5);
    const product = await seedProduct('p');
    await seedVariant(product.id, { name: 'High', quantityTotal: 50, quantitySold: 0 });
    await seedVariant(product.id, { name: 'Mid', quantityTotal: 20, quantitySold: 5 });
    await seedVariant(product.id, { name: 'Low', quantityTotal: 4, quantitySold: 0 });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/inventory',
      headers: { authorization: header },
    });
    const body = adminStoreInventoryListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.variantName)).toEqual(['Low', 'Mid', 'High']);
  });
});
