import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

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

const seedOpenCartWithGarageItem = async (userId: string) => {
  const { variant } = await ensureGarageProduct();
  const cart = await prisma.cart.create({
    data: { userId, status: 'open' },
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
  return { cart, variant };
};

describe('cart checkout — virtual garage product (JDMA TASK-C)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    ({ app } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('virtual-only cart checkout does not require a fulfillment method', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    await seedOpenCartWithGarageItem(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
    const body: { error?: string } = res.json();
    expect(body.error).toBeUndefined();
  });

  it('virtual-only cart checkout does not increment Variant.quantitySold', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await seedOpenCartWithGarageItem(user.id);
    const before = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });
    expect(res.statusCode).toBe(201);

    const after = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.quantitySold).toBe(before.quantitySold);
  });

  it('virtual-only cart order is created with fulfillmentMethod=virtual', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    await seedOpenCartWithGarageItem(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });
    expect(res.statusCode).toBe(201);

    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });
    expect(order.fulfillmentMethod).toBe('virtual');
    // virtual_complete only at settle time, not at checkout.
    expect(order.fulfillmentStatus).toBe('unfulfilled');
    expect(order.status).toBe('pending');
  });

  // PR #364 review (round 2): primary-shipping selection must filter virtual
  // products before preparation zeroes their fees. Even with a virtual product
  // carrying a higher (stale/erroneous) shippingFeeCents than the physical
  // sibling, the physical line must still win the primary-shipping slot.
  it('virtual products never win primary-shipping over a physical sibling', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { cart, variant: virtualVariant } = await seedOpenCartWithGarageItem(user.id);

    // Force a non-zero shippingFeeCents on the virtual product to simulate a
    // stale/erroneous data state. The fix must still ignore it.
    await prisma.product.update({
      where: { id: virtualVariant.productId },
      data: { shippingFeeCents: 9999 },
    });

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

    const pt = await prisma.productType.create({
      data: { name: `t-${Math.random().toString(36).slice(2, 6)}` },
    });
    const physProduct = await prisma.product.create({
      data: {
        slug: `phys-ship-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Camiseta Ship',
        description: 'd',
        productTypeId: pt.id,
        basePriceCents: 9000,
        currency: 'BRL',
        status: 'active',
        allowPickup: false,
        allowShip: true,
        shippingFeeCents: 1500,
        virtual: false,
      },
    });
    const physVariant = await prisma.variant.create({
      data: {
        productId: physProduct.id,
        name: 'M',
        priceCents: 9000,
        quantityTotal: 10,
        quantitySold: 0,
        attributes: {},
        active: true,
      },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        kind: 'product',
        variantId: physVariant.id,
        quantity: 1,
        amountCents: 9000,
        currency: 'BRL',
        tickets: [],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card', fulfillmentMethod: 'ship' },
    });

    expect(res.statusCode).toBe(201);
    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });
    // Physical line's 1500 must be applied; virtual's stale 9999 must be ignored.
    expect(order.shippingCents).toBe(1500);
  });

  it('mixed virtual + physical cart still requires fulfillment method for physical line', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { cart } = await seedOpenCartWithGarageItem(user.id);

    // Enable event pickup so both pickup and ship are candidates; the route then
    // forces FULFILLMENT_METHOD_REQUIRED rather than auto-selecting.
    await prisma.storeSettings.upsert({
      where: { id: 'store_default' },
      create: { id: 'store_default', storeEnabled: true, eventPickupEnabled: true },
      update: { eventPickupEnabled: true },
    });

    const pt = await prisma.productType.create({
      data: { name: `t-${Math.random().toString(36).slice(2, 6)}` },
    });
    const physProduct = await prisma.product.create({
      data: {
        slug: `phys-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Camiseta',
        description: 'd',
        productTypeId: pt.id,
        basePriceCents: 9000,
        currency: 'BRL',
        status: 'active',
        allowPickup: true,
        allowShip: true,
        shippingFeeCents: 1500,
        virtual: false,
      },
    });
    const physVariant = await prisma.variant.create({
      data: {
        productId: physProduct.id,
        name: 'M',
        priceCents: 9000,
        quantityTotal: 10,
        quantitySold: 0,
        attributes: {},
        active: true,
      },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        kind: 'product',
        variantId: physVariant.id,
        quantity: 1,
        amountCents: 9000,
        currency: 'BRL',
        tickets: [],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(422);
    const body: { code?: string } = res.json();
    expect(body.code).toBe('FULFILLMENT_METHOD_REQUIRED');
  });
});
