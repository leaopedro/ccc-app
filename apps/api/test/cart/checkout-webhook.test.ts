import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const seedCartWithOrders = async (userId: string, opts?: { events?: number }) => {
  const eventCount = opts?.events ?? 2;
  const events: Array<{ event: { id: string; title: string }; tier: { id: string } }> = [];

  for (let i = 0; i < eventCount; i++) {
    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: `Evento ${i + 1}`,
        description: 'desc',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
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
        priceCents: 5000,
        quantityTotal: 10,
        quantitySold: 1,
        sortOrder: 0,
      },
    });
    events.push({ event, tier });
  }

  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });

  const orders = await Promise.all(
    events.map(({ event, tier }) =>
      prisma.order.create({
        data: {
          userId,
          eventId: event.id,
          tierId: tier.id,
          cartId: cart.id,
          amountCents: 5000,
          quantity: 1,
          method: 'card',
          provider: 'stripe',
          status: 'pending',
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      }),
    ),
  );

  return { cart, orders, events };
};

const seedProductCartWithOrders = async (
  userId: string,
  opts?: { includeTicketOrder?: boolean; shippingFeeCents?: number | null },
) => {
  const shippingFeeCents = opts?.shippingFeeCents === undefined ? 1500 : opts.shippingFeeCents;
  const productType = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'Algodão premium',
      productTypeId: productType.id,
      basePriceCents: 9000,
      currency: 'BRL',
      status: 'active',
      shippingFeeCents,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Preto — M',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 9000,
      quantityTotal: 10,
      quantitySold: 1,
      attributes: { size: 'M' },
      active: true,
    },
  });
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });
  const address = await prisma.shippingAddress.create({
    data: {
      userId,
      recipientName: 'Maria Santos',
      line1: 'Rua das Flores',
      line2: 'Apto 10',
      number: '123',
      district: 'Centro',
      city: 'Curitiba',
      stateCode: 'PR',
      postalCode: '80000-000',
      phone: '41999999999',
      isDefault: true,
    },
  });

  const orders = [
    await prisma.order.create({
      data: {
        userId,
        cartId: cart.id,
        kind: 'product',
        amountCents: 9000 + (shippingFeeCents ?? 0),
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        shippingAddressId: shippingFeeCents === null ? null : address.id,
        shippingCents: shippingFeeCents ?? 0,
        fulfillmentMethod: shippingFeeCents === null ? 'pickup' : 'ship',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
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
    }),
  ];

  let ticketEvent: { eventId: string; tierId: string } | undefined;

  if (opts?.includeTicketOrder) {
    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Evento Misto',
        description: 'desc',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
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
        priceCents: 5000,
        quantityTotal: 10,
        quantitySold: 1,
        sortOrder: 0,
      },
    });
    ticketEvent = { eventId: event.id, tierId: tier.id };
    orders.push(
      await prisma.order.create({
        data: {
          userId,
          eventId: event.id,
          tierId: tier.id,
          cartId: cart.id,
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          status: 'pending',
          expiresAt: new Date(Date.now() + 15 * 60_000),
          items: {
            create: {
              kind: 'ticket',
              tierId: tier.id,
              quantity: 1,
              unitPriceCents: 5000,
              subtotalCents: 5000,
            },
          },
        },
      }),
    );
  }

  return { cart, orders, variant, ticketEvent };
};

const seedMixedSingleOrderCart = async (userId: string) => {
  const productType = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'Algodão premium',
      productTypeId: productType.id,
      basePriceCents: 9000,
      currency: 'BRL',
      status: 'active',
      shippingFeeCents: 1500,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Preto — M',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 9000,
      quantityTotal: 10,
      quantitySold: 1,
      attributes: { size: 'M' },
      active: true,
    },
  });
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento Misto',
      description: 'desc',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
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
      priceCents: 5000,
      quantityTotal: 10,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });
  const address = await prisma.shippingAddress.create({
    data: {
      userId,
      recipientName: 'Maria Santos',
      line1: 'Rua das Flores',
      number: '123',
      district: 'Centro',
      city: 'Curitiba',
      stateCode: 'PR',
      postalCode: '80000-000',
      phone: '41999999999',
      isDefault: true,
    },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      cartId: cart.id,
      kind: 'mixed',
      amountCents: 15_500,
      quantity: 2,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      shippingAddressId: address.id,
      shippingCents: 1500,
      fulfillmentMethod: 'ship',
      status: 'pending',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      items: {
        create: [
          {
            kind: 'product',
            variantId: variant.id,
            quantity: 1,
            unitPriceCents: 9000,
            subtotalCents: 9000,
          },
          {
            kind: 'ticket',
            tierId: tier.id,
            eventId: event.id,
            quantity: 1,
            unitPriceCents: 5000,
            subtotalCents: 5000,
          },
        ],
      },
    },
  });
  return { cart, order, event };
};

describe('POST /stripe/webhook (cart checkout settlement)', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let push: DevPushSender;

  beforeEach(async () => {
    await resetDatabase();
    stripe = buildFakeStripe();
    push = new DevPushSender();
    app = await buildApp(loadEnv(), { stripe, push });
  });

  afterEach(async () => {
    await app.close();
  });

  it('payment_intent.succeeded with cartId settles all cart orders', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_pi_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_1',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const settled = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true },
    });
    expect(settled.every((o) => o.status === 'paid')).toBe(true);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(orders.length);

    const updatedCart = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(updatedCart.status).toBe('converted');
  });

  it('checkout.session.completed with cartId settles all cart orders', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_cs_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_cart_1',
          payment_intent: 'pi_cart_cs_1',
          payment_status: 'paid',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const settled = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true },
    });
    expect(settled.every((o) => o.status === 'paid')).toBe(true);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(orders.length);
  });

  it('is idempotent: redelivery does not duplicate tickets', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_idem_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_idem',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
          },
        },
      },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    const second = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(second.statusCode).toBe(200);
    const body: { deduped?: boolean } = second.json();
    expect(body.deduped).toBe(true);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(orders.length);
  });

  it('checkout.session.expired with cartId releases all reservations', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders, events } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_expired_1',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_cart_exp_1',
          metadata: {
            cartId: cart.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const failedOrders = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true },
    });
    expect(failedOrders.every((o) => o.status === 'failed')).toBe(true);

    for (const { tier } of events) {
      const updated = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(updated.quantitySold).toBe(0);
    }

    const updatedCart = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(updatedCart.status).toBe('open');
  });

  it('payment_intent.payment_failed with cartId releases reservations', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders, events } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_pifail_1',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_cart_fail_1',
          metadata: {
            cartId: cart.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const failedOrders = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true },
    });
    expect(failedOrders.every((o) => o.status === 'failed')).toBe(true);

    for (const { tier } of events) {
      const updated = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(updated.quantitySold).toBe(0);
    }

    const updatedCart = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(updatedCart.status).toBe('open');
  });

  it('checkout.session.completed resolves cart via providerRef when session metadata lacks cartId', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedCartWithOrders(user.id);

    await prisma.order.update({
      where: { id: orders[0]!.id },
      data: { providerRef: 'pi_no_meta_cart' },
    });

    stripe.nextEvent = {
      id: 'evt_cs_no_cartid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_cartid_1',
          payment_intent: 'pi_no_meta_cart',
          payment_status: 'paid',
          metadata: { orderId: orders[0]!.id },
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

    const settled = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true },
    });
    expect(settled.every((o) => o.status === 'paid')).toBe(true);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(orders.length);
  });

  it('payment_intent.succeeded stamps providerRef on the canonical cart order', async () => {
    // charge.refunded resolves the order by providerRef. Cart orders never got
    // one: cart.ts only writes it when the Checkout Session already has a
    // payment_intent (it does not, at creation), and every settle/issue path
    // skips it for cart orders. Without this stamp the refund below cannot find
    // anything to refund.
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_pi_stamp',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_cart_stamp', metadata: { cartId: cart.id, userId: user.id } },
      },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    const stamped = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { id: true, providerRef: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(stamped.some((o) => o.providerRef === 'pi_cart_stamp')).toBe(true);
    expect(orders).toHaveLength(2);
  });

  it('charge.refunded flips every cart order to refunded and revokes the tickets', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_pi_refund',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_cart_refund', metadata: { cartId: cart.id, userId: user.id } },
      },
    };
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    const total = orders.reduce((sum, o) => sum + o.amountCents, 0);
    stripe.nextEvent = {
      id: 'evt_cart_charge_refunded',
      type: 'charge.refunded',
      data: {
        object: { payment_intent: 'pi_cart_refund', amount: total, amount_refunded: total },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    // Assert the DB, not the Stripe dashboard: money out with a valid ticket is
    // the whole failure mode here.
    const refunded = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true },
    });
    expect(refunded).toHaveLength(orders.length);
    expect(refunded.every((o) => o.status === 'refunded')).toBe(true);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((t) => t.status === 'revoked')).toBe(true);
  });

  it('refunds instead of ignoring when a cart is paid after its orders expired', async () => {
    // ORDER_EXPIRY_MS is 15 minutes but the Checkout Session lives 30+. Pay in
    // that gap, after the reservation sweep expired the orders, and the handler
    // used to answer `ignored: true`: money in, no order, no refund, no alert.
    // The single-order path already refunds here; the cart path did not.
    const { user } = await createUser({ verified: true });
    const { cart } = await seedCartWithOrders(user.id);
    await prisma.order.updateMany({ where: { cartId: cart.id }, data: { status: 'expired' } });

    stripe.nextEvent = {
      id: 'evt_cart_paid_after_expiry',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_cart_after_expiry', metadata: { cartId: cart.id, userId: user.id } },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const refunds = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.payload).toMatchObject({ paymentIntentId: 'pi_cart_after_expiry' });

    // No ticket may exist for an order that was already expired.
    expect(await prisma.ticket.count({ where: { userId: user.id } })).toBe(0);
  });

  it('charge.dispute.created revokes the tickets of the disputed cart', async () => {
    // Without this branch a disputed ticket order stays `paid` with a valid QR:
    // the attendee walks in and keeps the money. Stripe disputes were entirely
    // unhandled — `rg dispute src/routes/stripe-webhook.ts` returned nothing.
    const { user } = await createUser({ verified: true });
    const { cart } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_pi_disputed',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_cart_disputed', metadata: { cartId: cart.id, userId: user.id } },
      },
    };
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    stripe.nextEvent = {
      id: 'evt_dispute_created',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', payment_intent: 'pi_cart_disputed', amount: 10000 } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((t) => t.status === 'revoked')).toBe(true);
  });

  it('charge.dispute.created for an unknown PaymentIntent still acks', async () => {
    stripe.nextEvent = {
      id: 'evt_dispute_unknown',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_2', payment_intent: 'pi_never_seen', amount: 5000 } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    // Ack so Stripe stops retrying; the Sentry alert is what reaches a human.
    expect(res.statusCode).toBe(200);
  });

  it('charge.dispute.closed acks without touching entitlement', async () => {
    const { user } = await createUser({ verified: true });
    const { cart } = await seedCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_pi_dispute_closed',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_cart_dispute_closed', metadata: { cartId: cart.id, userId: user.id } },
      },
    };
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    stripe.nextEvent = {
      id: 'evt_dispute_closed',
      type: 'charge.dispute.closed',
      data: {
        object: { id: 'dp_3', payment_intent: 'pi_cart_dispute_closed', status: 'won' },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    // Winning a dispute does not re-issue anything, and losing one does not
    // revoke twice: closure is an operator decision, so state is untouched.
    const orders = await prisma.order.findMany({ where: { cartId: cart.id } });
    expect(orders.every((o) => o.status === 'paid')).toBe(true);
  });

  it('bumps cart.version on failure so the retry gets a fresh Stripe session', async () => {
    // The checkout idempotency key is `cart_checkout_${id}_v${version}`. Without
    // the bump, a customer retrying an unchanged cart sends the same key and
    // Stripe replays the original response for 24h — including the already
    // consumed session URL. They land on a dead checkout page and cannot pay.
    const { user } = await createUser({ verified: true });
    const { cart } = await seedCartWithOrders(user.id);
    const before = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });

    stripe.nextEvent = {
      id: 'evt_cart_pi_failed_version',
      type: 'payment_intent.payment_failed',
      data: {
        object: { id: 'pi_cart_failed_version', metadata: { cartId: cart.id, userId: user.id } },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const after = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(after.status).toBe('open');
    expect(after.version).toBe(before.version + 1);
  });

  it('payment_intent.succeeded settles product-only carts without issuing tickets', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedProductCartWithOrders(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_product_only',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_product_only',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const settled = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { status: true, shippingAddressId: true, shippingCents: true },
    });
    expect(settled).toEqual([
      expect.objectContaining({
        status: 'paid',
        shippingCents: 1500,
      }),
    ]);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(0);
  });

  it('payment_intent.succeeded settles mixed carts and only issues event tickets', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders } = await seedProductCartWithOrders(user.id, { includeTicketOrder: true });

    stripe.nextEvent = {
      id: 'evt_cart_mixed_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_mixed_1',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const updatedOrders = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { kind: true, status: true },
    });
    expect(updatedOrders.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'product', status: 'paid' },
      { kind: 'ticket', status: 'paid' },
    ]);

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(1);
  });

  it('payment_intent.succeeded on single mixed Order cart fires ticket.confirmed push', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[mixed1]', platform: 'ios' },
    });
    const { cart, order } = await seedMixedSingleOrderCart(user.id);

    stripe.nextEvent = {
      id: 'evt_cart_mixed_single_push',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_mixed_single_push',
          metadata: { cartId: cart.id, userId: user.id },
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

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');
    expect(updated.kind).toBe('mixed');

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(1);

    expect(push.captured).toHaveLength(1);
    expect(push.captured[0]?.title.toLowerCase()).toContain('ingressos');

    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notif.dedupeKey).toBe(`cart_${cart.id}`);
  });

  it('payment_intent.succeeded assigns event pickup only after the ticket order is paid', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders, ticketEvent } = await seedProductCartWithOrders(user.id, {
      includeTicketOrder: true,
      shippingFeeCents: null,
    });

    await prisma.order.update({
      where: { id: orders[0]!.id },
      data: { pickupEventId: ticketEvent!.eventId },
    });

    const before = await prisma.order.findUniqueOrThrow({
      where: { id: orders[0]!.id },
      select: { pickupTicketId: true },
    });
    expect(before.pickupTicketId).toBeNull();

    stripe.nextEvent = {
      id: 'evt_cart_event_pickup_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_event_pickup_1',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { userId: user.id, eventId: ticketEvent!.eventId },
      select: { id: true },
    });
    const productOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orders[0]!.id },
      select: { status: true, pickupTicketId: true },
    });
    expect(productOrder.status).toBe('paid');
    expect(productOrder.pickupTicketId).toBe(ticket.id);
  });

  it('payment_intent.succeeded binds mixed single-order pickup to a same-order ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order, event } = await seedMixedSingleOrderCart(user.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { pickupEventId: event.id, fulfillmentMethod: 'pickup' },
    });

    stripe.nextEvent = {
      id: 'evt_cart_mixed_pickup_same_order',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_mixed_pickup_same_order',
          metadata: { cartId: cart.id, userId: user.id },
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

    const settled = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, pickupTicketId: true },
    });
    expect(settled.status).toBe('paid');
    expect(settled.pickupTicketId).not.toBeNull();

    const sameOrderTicket = await prisma.ticket.findFirstOrThrow({
      where: { orderId: order.id, eventId: event.id, status: 'valid' },
      select: { id: true },
    });
    expect(settled.pickupTicketId).toBe(sameOrderTicket.id);
  });

  it('duplicate ticket in multi-order cart issues partial refund, not full PI refund', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, orders, events } = await seedCartWithOrders(user.id);

    await prisma.event.update({
      where: { id: events[0]!.event.id },
      data: { maxTicketsPerUser: 1 },
    });
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: events[0]!.event.id,
        tierId: events[0]!.tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    stripe.nextEvent = {
      id: 'evt_cart_dup_partial',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_cart_dup',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify(orders.map((o) => o.id)),
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

    const refundCalls = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refundCalls).toHaveLength(1);
    const refundPayload = refundCalls[0]!.payload as { amountCents?: number };
    expect(refundPayload.amountCents).toBe(5000);

    const orderStatuses = await prisma.order.findMany({
      where: { cartId: cart.id },
      select: { id: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    const firstOrder = orderStatuses.find((o) => o.id === orders[0]!.id);
    const secondOrder = orderStatuses.find((o) => o.id === orders[1]!.id);
    expect(firstOrder!.status).toBe('refunded');
    expect(secondOrder!.status).toBe('paid');

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(2);
  });
});
