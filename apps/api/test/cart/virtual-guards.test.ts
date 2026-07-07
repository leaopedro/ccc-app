import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { evictStaleItems } from '../../src/services/cart/index.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const ensureGarageProduct = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    update: {},
    create: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
  });
  const product = await prisma.product.upsert({
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
  let variant = await prisma.variant.findFirst({ where: { productId: product.id } });
  variant ??= await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

const seedPhysicalProduct = async (opts?: { allowShip?: boolean; allowPickup?: boolean }) => {
  const pt = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta',
      description: 'd',
      productTypeId: pt.id,
      basePriceCents: 9000,
      currency: 'BRL',
      status: 'active',
      allowShip: opts?.allowShip ?? true,
      allowPickup: opts?.allowPickup ?? false,
      shippingFeeCents: 1500,
      virtual: false,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'M',
      priceCents: 9000,
      quantityTotal: 10,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

const disableStore = async () => {
  await prisma.storeSettings.upsert({
    where: { id: 'store_default' },
    update: { storeEnabled: false },
    create: { id: 'store_default', storeEnabled: false },
  });
};

describe('Cart virtual-product guards (PR #364 review fixes)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects qty>1 for virtual product on POST /cart/items', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    const res = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 2 } },
    });

    expect(res.statusCode).toBe(422);
    const body: { code?: string } = res.json();
    expect(body.code).toBe('VIRTUAL_QUANTITY_INVALID');
  });

  it('allows adding a virtual product even when store is disabled', async () => {
    await disableStore();
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    const res = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    expect(res.statusCode).toBe(200);
  });

  it('still blocks physical products when store is disabled', async () => {
    await disableStore();
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await seedPhysicalProduct();

    const res = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    expect(res.statusCode).toBe(503);
  });

  it('adding a virtual product to a cart with a physical line does not flag fulfillment conflict', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant: physical } = await seedPhysicalProduct({ allowShip: true });
    const { variant: garage } = await ensureGarageProduct();

    const addPhysical = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: physical.id, quantity: 1 } },
    });
    expect(addPhysical.statusCode).toBe(200);

    const addVirtual = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: garage.id, quantity: 1 } },
    });

    expect(addVirtual.statusCode).toBe(200);
    const body: { cart?: { items: unknown[] } } = addVirtual.json();
    expect(body.cart?.items.length).toBe(2);
  });

  it('evictStaleItems does NOT remove a virtual product line with default 0/0 stock', async () => {
    const { user } = await createUser({ verified: true });
    const { variant } = await ensureGarageProduct();
    const cart = await prisma.cart.create({
      data: { userId: user.id, status: 'open' },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        kind: 'product',
        variantId: variant.id,
        quantity: 1,
        amountCents: variant.priceCents,
        currency: 'BRL',
        tickets: [],
      },
    });

    const cartWithItems = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            extras: true,
            tier: { select: { priceCents: true, currency: true, requiresCar: true } },
            variant: {
              select: {
                id: true,
                productId: true,
                name: true,
                sku: true,
                priceCents: true,
                attributes: true,
                active: true,
                quantityTotal: true,
                quantitySold: true,
                product: {
                  select: {
                    id: true,
                    slug: true,
                    title: true,
                    currency: true,
                    allowPickup: true,
                    allowShip: true,
                    shippingFeeCents: true,
                    virtual: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const evicted = await evictStaleItems(cartWithItems);
    expect(evicted).toEqual([]);

    const remaining = await prisma.cartItem.count({ where: { cartId: cart.id } });
    expect(remaining).toBe(1);
  });
});
