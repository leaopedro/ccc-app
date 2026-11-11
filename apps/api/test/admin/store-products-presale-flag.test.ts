import { prisma } from '@ccc/db';
import { GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/shared/garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { loadEligiblePresaleProducts } from '../../src/services/presale/eligibility.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import { createPresaleProduct } from '../presale/fixtures.js';

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
      visibleInPresale: false,
    },
  });
};

// Same upsert pattern as test/cart/garage-checkout.test.ts: resetDatabase()
// clears Product and nothing in this suite re-seeds the garage-spot
// singleton, so a bare findUnique always returns null here.
const ensureGarageProduct = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    update: {},
    create: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
  });
  return prisma.product.upsert({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    update: {},
    create: {
      slug: GARAGE_SPOT_PRODUCT_SLUG,
      title: 'Vaga de Garagem Adicional',
      description: '-',
      productTypeId: pt.id,
      basePriceCents: 5000,
      currency: 'BRL',
      status: 'active',
      allowPickup: false,
      allowShip: false,
      virtual: true,
      visibleInStore: false,
    },
  });
};

const orgAuth = async () => {
  const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
  return bearer(loadEnv(), user.id, 'organizer');
};

const userAuth = async () => {
  const { user } = await createUser({ email: 'user@jdm.test', verified: true, role: 'user' });
  return bearer(loadEnv(), user.id, 'user');
};

const patch = async (app: FastifyInstance, productId: string, payload: Record<string, unknown>) => {
  const header = await orgAuth();
  return app.inject({
    method: 'PATCH',
    url: `/admin/store/products/${productId}`,
    headers: { authorization: header },
    payload,
  });
};

describe('PATCH /admin/store/products/:id visibleInPresale flag', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('nasce desmarcado e o PATCH marca', async () => {
    const product = await seedDraftProduct('camiseta-presale');
    expect(product.visibleInPresale).toBe(false);

    const res = await patch(app, product.id, { visibleInPresale: true });
    expect(res.statusCode).toBe(200);
    const updated = await prisma.product.findUnique({ where: { id: product.id } });
    expect(updated!.visibleInPresale).toBe(true);
  });

  it('desmarcar tira o produto da pré-venda', async () => {
    // Eligible to start: active, non-virtual, BRL, with a photo and an active
    // variant (PRESALE_PRODUCT_WHERE). A bare draft product with no photos
    // would already be ineligible regardless of the flag, making the
    // assertion below pass for the wrong reason.
    const product = await createPresaleProduct({ slug: 'camiseta-presale-2' });
    const eligibleBefore = await loadEligiblePresaleProducts();
    expect(eligibleBefore.map((p) => p.id)).toContain(product.id);

    await patch(app, product.id, { visibleInPresale: false });

    const eligible = await loadEligiblePresaleProducts();
    expect(eligible.map((p) => p.id)).not.toContain(product.id);
  });

  it('400 ao tentar marcar um produto singleton', async () => {
    const garageSpot = await ensureGarageProduct();

    const singletonRes = await patch(app, garageSpot.id, { visibleInPresale: true });
    expect(singletonRes.statusCode).toBe(400);
    expect(singletonRes.json()).toMatchObject({ error: 'BadRequest' });
  });

  it('exige papel de admin', async () => {
    const product = await seedDraftProduct('camiseta-presale-3');
    const userHeader = await userAuth();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: userHeader },
      payload: { visibleInPresale: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('não altera visibleInStore', async () => {
    const product = await seedDraftProduct('virtual-product');
    await prisma.product.update({
      where: { id: product.id },
      data: { virtual: true, visibleInStore: true },
    });

    const res = await patch(app, product.id, { visibleInPresale: true });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.product.findUnique({ where: { id: product.id } });
    expect(updated!.visibleInStore).toBe(true);
    expect(updated!.visibleInPresale).toBe(true);
  });
});
