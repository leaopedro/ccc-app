import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { fulfillGarageSpotsForOrder } from '../../src/services/orders/garage-fulfillment.js';
import { createUser, resetDatabase } from '../helpers.js';

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

const seedPendingGarageOrder = async (userId: string) => {
  const { variant } = await ensureGarageProduct();
  const order = await prisma.order.create({
    data: {
      userId,
      kind: 'product',
      amountCents: 5000,
      baseAmountCents: 5000,
      quantity: 1,
      method: 'card',
      provider: 'stripe',
      status: 'pending',
      currency: 'BRL',
      fulfillmentMethod: 'virtual',
      items: {
        create: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      },
    },
    include: { items: true },
  });
  return { order, orderItemId: order.items[0]!.id };
};

describe('fulfillGarageSpotsForOrder', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates one GarageSpot per garage OrderItem with source=purchase, carId=null', async () => {
    const { user } = await createUser({ verified: true });
    const { order, orderItemId } = await seedPendingGarageOrder(user.id);

    const result = await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));

    expect(result.fulfilledOrderItemIds).toEqual([orderItemId]);
    expect(result.orderIsAllVirtual).toBe(true);

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({
      source: 'purchase',
      sourceOrderItemId: orderItemId,
      carId: null,
    });
  });

  it('is idempotent across replays (P2002 swallowed)', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedPendingGarageOrder(user.id);

    await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));
    await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
  });

  it('orderIsAllVirtual=false when the order also has a ticket OrderItem', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedPendingGarageOrder(user.id);

    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Mixed',
        description: 'd',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 10,
        maxTicketsPerUser: 5,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 1000,
        quantityTotal: 5,
        quantitySold: 0,
        sortOrder: 0,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        kind: 'ticket',
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        unitPriceCents: 1000,
        subtotalCents: 1000,
      },
    });

    const result = await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));

    expect(result.orderIsAllVirtual).toBe(false);
    expect(result.fulfilledOrderItemIds).toHaveLength(1);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
  });

  it('ignores non-virtual product OrderItems', async () => {
    const { user } = await createUser({ verified: true });

    const pt = await prisma.productType.create({
      data: { name: `phys-${Math.random().toString(36).slice(2, 6)}` },
    });
    const product = await prisma.product.create({
      data: {
        slug: `phys-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Camiseta',
        description: 'd',
        productTypeId: pt.id,
        basePriceCents: 9000,
        currency: 'BRL',
        status: 'active',
        allowPickup: true,
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
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 9000,
        baseAmountCents: 9000,
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        currency: 'BRL',
        fulfillmentMethod: 'pickup',
        items: {
          create: {
            kind: 'product',
            variantId: variant.id,
            quantity: 1,
            unitPriceCents: 9000,
            subtotalCents: 9000,
          },
        },
      },
    });

    const result = await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));
    expect(result.fulfilledOrderItemIds).toEqual([]);
    expect(result.orderIsAllVirtual).toBe(false);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(0);
  });
});
