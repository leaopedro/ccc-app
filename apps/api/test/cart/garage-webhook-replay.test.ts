import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

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
      title: 'Vaga',
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

const seedPendingGarageOrderWithCart = async (userId: string) => {
  const { variant } = await ensureGarageProduct();
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      kind: 'product',
      cartId: cart.id,
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
  return { cart, order, orderItemId: order.items[0]!.id };
};

describe('POST /stripe/webhook — garage spot fulfillment (JDMA TASK-C)', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    stripe = buildFakeStripe();
    app = await buildApp(loadEnv(), { stripe, push: new DevPushSender() });
  });

  afterEach(async () => {
    await app.close();
  });

  it('settles a virtual-only order and creates exactly one GarageSpot', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order, orderItemId } = await seedPendingGarageOrderWithCart(user.id);

    stripe.nextEvent = {
      id: 'evt_garage_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_1',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled.status).toBe('paid');
    expect(settled.fulfillmentStatus).toBe('virtual_complete');

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({
      source: 'purchase',
      sourceOrderItemId: orderItemId,
      carId: null,
    });
  });

  it('replayed webhook does not duplicate the GarageSpot', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order } = await seedPendingGarageOrderWithCart(user.id);

    stripe.nextEvent = {
      id: 'evt_garage_replay',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_replay',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(second.statusCode).toBe(200);

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
  });

  it('mixed order (ticket + garage) creates one spot and one ticket, fulfillmentStatus stays unfulfilled', async () => {
    const { user } = await createUser({ verified: true });
    const { variant } = await ensureGarageProduct();

    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Evento',
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
    const cart = await prisma.cart.create({ data: { userId: user.id, status: 'checking_out' } });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'mixed',
        cartId: cart.id,
        amountCents: 6000,
        baseAmountCents: 6000,
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        currency: 'BRL',
        fulfillmentMethod: 'pickup',
        items: {
          create: [
            {
              kind: 'ticket',
              eventId: event.id,
              tierId: tier.id,
              quantity: 1,
              unitPriceCents: 1000,
              subtotalCents: 1000,
              tickets: [{ extras: [] }],
            },
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 5000,
              subtotalCents: 5000,
            },
          ],
        },
      },
    });

    stripe.nextEvent = {
      id: 'evt_garage_mixed',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_mixed',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled.status).toBe('paid');
    // Mixed order is not all-virtual.
    expect(settled.fulfillmentStatus).toBe('unfulfilled');

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(1);
  });

  it('refunding a paid garage order leaves the GarageSpot intact (manual recipe scope)', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order } = await seedPendingGarageOrderWithCart(user.id);

    stripe.nextEvent = {
      id: 'evt_garage_refund_settle',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_refund_settle',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };
    const settleRes = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(settleRes.statusCode).toBe(200);

    // Refund-cleanup is deferred per Car_spot_plan §2. Flipping status to
    // 'refunded' must NOT cascade-delete the GarageSpot. Admin manual recipe
    // (DELETE /admin/users/:id/spots/:spotId) lives in TASK-G.
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded', refundedAt: new Date(), fulfillmentStatus: 'cancelled' },
    });

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]?.source).toBe('purchase');
  });
});
