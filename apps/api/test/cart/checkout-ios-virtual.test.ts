import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

// Copied from virtual-guards.test.ts:11-80 (ancora de 2026-08-29) per task brief.
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

describe('POST /cart/checkout — item virtual no iOS', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    ({ app } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('recusa 403 quando o carrinho tem linha virtual e a plataforma e iOS', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { paymentMethod: 'card', flow: 'native' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: 'PlatformNotSupported',
      code: 'VIRTUAL_ITEM_IOS_BLOCKED',
    });

    // A recusa não deve deixar o carrinho em checking_out nem criar pedido.
    const cart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id } });
    expect(cart.status).toBe('open');
    const orderCount = await prisma.order.count({ where: { userId: user.id } });
    expect(orderCount).toBe(0);
  });

  it('permite a mesma linha virtual na web', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'web' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('permite a mesma linha virtual no android', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'android' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('nao recusa carrinho so com item fisico no iOS', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await seedPhysicalProduct();

    await prisma.shippingAddress.create({
      data: {
        userId: user.id,
        recipientName: 'Maria Santos',
        line1: 'Rua das Flores',
        number: '123',
        district: 'Centro',
        city: 'Curitiba',
        stateCode: 'PR',
        postalCode: '80000-000',
        isDefault: true,
      },
    });

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { paymentMethod: 'card', flow: 'native', fulfillmentMethod: 'ship' },
    });

    expect(res.statusCode).not.toBe(403);
  });
});
