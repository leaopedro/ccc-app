import { prisma } from '@jdm/db';
import { myOrdersResponseSchema } from '@jdm/shared/orders';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  bearer,
  createUser,
  makeAppWithFakes,
  makeAppWithFakeStripe,
  resetDatabase,
} from '../helpers.js';

const env = loadEnv();

const seedEvent = async () => {
  const event = await prisma.event.create({
    data: {
      slug: `event-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Encontro JDM',
      description: 'Pista liberada',
      startsAt: new Date('2026-06-10T18:00:00.000Z'),
      endsAt: new Date('2026-06-10T23:00:00.000Z'),
      venueName: 'Autódromo',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 200,
      maxTicketsPerUser: 5,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 8_000,
      currency: 'BRL',
      quantityTotal: 200,
    },
  });
  const extra = await prisma.ticketExtra.create({
    data: {
      eventId: event.id,
      name: 'Adesivo',
      description: 'Kit adesivo',
      priceCents: 2_000,
      currency: 'BRL',
      quantityTotal: 50,
    },
  });
  return { event, tier, extra };
};

const seedProductVariant = async () => {
  const productType = await prisma.productType.create({
    data: { name: `Merch ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `produto-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'Algodão pesado',
      productTypeId: productType.id,
      basePriceCents: 12_000,
      currency: 'BRL',
      status: 'active',
      shippingFeeCents: 1_500,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Preta / G',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 12_000,
      quantityTotal: 20,
      attributes: { size: 'G', color: 'Preta' },
      active: true,
    },
  });
  return { product, variant };
};

describe('GET /me/orders', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    ({ app } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists product-only and mixed orders with fulfillment metadata and line items', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier, extra } = await seedEvent();
    const { variant } = await seedProductVariant();

    const productOnly = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 13_500,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date('2026-05-06T15:30:00.000Z'),
        shippingCents: 1_500,
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'shipped',
        createdAt: new Date('2026-05-06T15:00:00.000Z'),
        items: {
          create: [
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 12_000,
              subtotalCents: 12_000,
            },
          ],
        },
      },
    });

    const mixed = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'mixed',
        amountCents: 23_500,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date('2026-05-07T18:30:00.000Z'),
        shippingCents: 1_500,
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'packed',
        createdAt: new Date('2026-05-07T18:00:00.000Z'),
        items: {
          create: [
            {
              kind: 'ticket',
              tierId: tier.id,
              eventId: event.id,
              quantity: 1,
              unitPriceCents: 8_000,
              subtotalCents: 8_000,
            },
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 12_000,
              subtotalCents: 12_000,
            },
            {
              kind: 'extras',
              extraId: extra.id,
              quantity: 1,
              unitPriceCents: 2_000,
              subtotalCents: 2_000,
            },
          ],
        },
      },
    });

    const issuedTicket = await prisma.ticket.create({
      data: {
        orderId: mixed.id,
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/orders',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = myOrdersResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);

    const latest = body.items[0]!;
    const older = body.items[1]!;
    expect(latest).toMatchObject({
      kind: 'mixed',
      status: 'paid',
      containsTickets: true,
      containsStoreItems: true,
      fulfillmentMethod: 'ship',
      fulfillmentStatus: 'packed',
      event: { id: event.id, title: event.title },
    });
    expect(latest.shortId).toBe(latest.id.slice(-8).toUpperCase());
    expect(latest.shortId).toMatch(/^[0-9A-Z]{8}$/);
    expect(latest.items.map((item) => item.kind)).toEqual(['ticket', 'product', 'extras']);
    expect(latest.items[0]).toMatchObject({
      title: event.title,
      detail: tier.name,
      ticketIds: [issuedTicket.id],
    });
    expect(latest.items[1]).toMatchObject({ title: 'Camiseta JDM', detail: 'Preta / G' });
    expect(latest.items[1]?.ticketIds).toBeUndefined();
    expect(latest.items[2]).toMatchObject({ title: extra.name, detail: event.title });
    expect(latest.items[2]?.ticketIds).toBeUndefined();

    expect(older).toMatchObject({
      id: productOnly.id,
      shortId: productOnly.id.slice(-8).toUpperCase(),
      kind: 'product',
      containsTickets: false,
      containsStoreItems: true,
      fulfillmentStatus: 'shipped',
      fulfillmentMethod: 'ship',
      event: null,
    });
    expect(older.items).toEqual([
      expect.objectContaining({
        kind: 'product',
        title: 'Camiseta JDM',
        detail: 'Preta / G',
        quantity: 1,
      }),
    ]);
  });

  it('returns only the authenticated user orders', async () => {
    const { user } = await createUser({ verified: true });
    const { user: other } = await createUser({ email: 'other-orders@jdm.test', verified: true });

    await prisma.order.create({
      data: {
        userId: other.id,
        kind: 'product',
        amountCents: 5_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/orders',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = myOrdersResponseSchema.parse(res.json());
    expect(body.items).toEqual([]);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/orders',
    });

    expect(res.statusCode).toBe(401);
  });

  it('exposes pickupTicketId on paid pickup orders bound to a ticket the user owns', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    const { variant } = await seedProductVariant();

    const ticketOrder = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 8_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date('2026-05-08T10:00:00.000Z'),
        createdAt: new Date('2026-05-08T09:30:00.000Z'),
        items: {
          create: [
            {
              kind: 'ticket',
              tierId: tier.id,
              eventId: event.id,
              quantity: 1,
              unitPriceCents: 8_000,
              subtotalCents: 8_000,
            },
          ],
        },
      },
    });

    const ticket = await prisma.ticket.create({
      data: {
        orderId: ticketOrder.id,
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const pickup = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 12_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date('2026-05-09T12:00:00.000Z'),
        createdAt: new Date('2026-05-09T11:30:00.000Z'),
        fulfillmentMethod: 'pickup',
        fulfillmentStatus: 'unfulfilled',
        pickupEventId: event.id,
        pickupTicketId: ticket.id,
        items: {
          create: [
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 12_000,
              subtotalCents: 12_000,
            },
          ],
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/orders',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = myOrdersResponseSchema.parse(res.json());
    const pickupRow = body.items.find((o) => o.id === pickup.id);
    const ticketRow = body.items.find((o) => o.id === ticketOrder.id);
    expect(pickupRow?.pickupTicketId).toBe(ticket.id);
    expect(pickupRow?.fulfillmentMethod).toBe('pickup');
    expect(ticketRow?.pickupTicketId).toBeNull();
  });

  it('omits pickupTicketId when the bound ticket belongs to another user', async () => {
    const { user } = await createUser({ verified: true });
    const { user: stranger } = await createUser({
      email: 'stranger-pickup@jdm.test',
      verified: true,
    });
    const { event, tier } = await seedEvent();
    const { variant } = await seedProductVariant();

    const strangerOrder = await prisma.order.create({
      data: {
        userId: stranger.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 8_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
      },
    });
    const strangerTicket = await prisma.ticket.create({
      data: {
        orderId: strangerOrder.id,
        userId: stranger.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const pickup = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 9_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
        fulfillmentMethod: 'pickup',
        fulfillmentStatus: 'unfulfilled',
        pickupEventId: event.id,
        pickupTicketId: strangerTicket.id,
        items: {
          create: [
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 9_000,
              subtotalCents: 9_000,
            },
          ],
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/orders',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = myOrdersResponseSchema.parse(res.json());
    const row = body.items.find((o) => o.id === pickup.id);
    expect(row?.pickupTicketId).toBeNull();
  });
});

describe('POST /me/orders/:id/cancel', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app.close();
  });

  it('cancels a pending Stripe order, releases reservations, and cancels the payment intent', async () => {
    const harness = await makeAppWithFakeStripe();
    app = harness.app;
    const { stripe } = harness;

    const { user } = await createUser({ verified: true });
    const { event, tier, extra } = await seedEvent();

    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 2 },
    });
    await prisma.ticketExtra.update({
      where: { id: extra.id },
      data: { quantitySold: 1 },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 18_000,
        currency: 'BRL',
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_cancel_me',
        status: 'pending',
        orderExtras: {
          create: [{ extraId: extra.id, quantity: 1 }],
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${order.id}/cancel`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      orderId: order.id,
      status: 'cancelled',
    });

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('cancelled');
    expect(reloadedOrder.fulfillmentStatus).toBe('cancelled');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const reloadedExtra = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
    expect(reloadedExtra.quantitySold).toBe(0);

    const cancelCalls = stripe.calls.filter((call) => call.kind === 'cancelPaymentIntent');
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.payload).toMatchObject({ paymentIntentId: 'pi_cancel_me' });
  });

  it('cancels a pending Stripe order locally when providerRef is null', async () => {
    const harness = await makeAppWithFakeStripe();
    app = harness.app;
    const { stripe } = harness;

    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();

    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 8_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        providerRef: null,
        status: 'pending',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${order.id}/cancel`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ orderId: order.id, status: 'cancelled' });

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('cancelled');

    const cancelCalls = stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent');
    expect(cancelCalls).toHaveLength(0);
  });

  it('keeps the order pending when Stripe cancellation fails upstream', async () => {
    const harness = await makeAppWithFakeStripe();
    app = harness.app;
    const { stripe } = harness;
    stripe.nextCancelPaymentIntentError = new Error('stripe cancel failed');

    const { user } = await createUser({ verified: true });
    const { event, tier, extra } = await seedEvent();

    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });
    await prisma.ticketExtra.update({
      where: { id: extra.id },
      data: { quantitySold: 1 },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 10_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_cancel_fail',
        status: 'pending',
        orderExtras: {
          create: [{ extraId: extra.id, quantity: 1 }],
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${order.id}/cancel`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: 'BadGateway',
      message: 'could not confirm stripe payment intent cancellation',
    });

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('pending');
    expect(reloadedOrder.fulfillmentStatus).toBe('unfulfilled');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(1);

    const reloadedExtra = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
    expect(reloadedExtra.quantitySold).toBe(1);
  });

  it('cancels a pending AbacatePay order locally and leaves upstream untouched', async () => {
    const harness = await makeAppWithFakes();
    app = harness.app;
    const { stripe, abacatepay } = harness;

    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();

    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 8_000,
        currency: 'BRL',
        quantity: 1,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'pix_cancel_me',
        status: 'pending',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${order.id}/cancel`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      orderId: order.id,
      status: 'cancelled',
    });

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('cancelled');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    expect(stripe.calls.filter((call) => call.kind === 'cancelPaymentIntent')).toHaveLength(0);
    expect(abacatepay.calls).toEqual([]);
  });

  it('returns 403 when trying to cancel another user order', async () => {
    const harness = await makeAppWithFakeStripe();
    app = harness.app;

    const { user } = await createUser({ verified: true });
    const { user: other } = await createUser({ email: 'other-cancel@jdm.test', verified: true });
    const { event, tier } = await seedEvent();

    const order = await prisma.order.create({
      data: {
        userId: other.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 8_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${order.id}/cancel`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 409 when the order is no longer pending', async () => {
    const harness = await makeAppWithFakeStripe();
    app = harness.app;

    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 8_000,
        currency: 'BRL',
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${order.id}/cancel`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'Conflict' });
  });
});
