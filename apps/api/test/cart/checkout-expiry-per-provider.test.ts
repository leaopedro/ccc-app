import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { runOrderExpiryTick } from '../../src/workers/order-expiry.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

// F2: ORDER_EXPIRY_MS (15 min) is shorter than the Stripe Checkout Session
// minimum TTL (STRIPE_MIN_SESSION_MS, 30 min). The order-expiry worker
// (order-expiry.ts) runs every minute unconditionally, so a hosted order
// created with the global 15-min TTL gets killed while the customer is still
// on the Stripe-hosted page (3DS, bank app). Hosted orders must carry a TTL
// at least as long as the session; native PaymentSheet orders stay at 15 min
// on purpose, since that is the exposure window Task 7 exists to close.
const seedPublishedEvent = async () => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento Teste',
      description: 'Descrição',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 100,
      maxTicketsPerUser: 5,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      currency: 'BRL',
      quantityTotal: 50,
      quantitySold: 0,
    },
  });
  return { event, tier };
};

const addCartItem = async (
  app: FastifyInstance,
  token: string,
  item: { eventId: string; tierId: string },
) => {
  const res = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: token },
    payload: {
      item: {
        eventId: item.eventId,
        tierId: item.tierId,
        source: 'purchase',
        kind: 'ticket',
        quantity: 1,
        tickets: [{ extras: [] }],
      },
    },
  });
  expect(res.statusCode).toBe(200);
};

describe('expiracao de pedido e por provedor/flow, nao um TTL global', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('pedido hospedado sobrevive a 20 min; pedido nativo e varrido no mesmo tick', async () => {
    const { user: hostedUser } = await createUser({ verified: true, email: 'hosted@jdm.test' });
    const { user: nativeUser } = await createUser({ verified: true, email: 'native@jdm.test' });
    const hostedToken = bearer(env, hostedUser.id);
    const nativeToken = bearer(env, nativeUser.id);

    const { event: hostedEvent, tier: hostedTier } = await seedPublishedEvent();
    const { event: nativeEvent, tier: nativeTier } = await seedPublishedEvent();

    await addCartItem(app, hostedToken, { eventId: hostedEvent.id, tierId: hostedTier.id });
    await addCartItem(app, nativeToken, { eventId: nativeEvent.id, tierId: nativeTier.id });

    const hostedCheckout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: hostedToken },
      payload: { paymentMethod: 'card', flow: 'hosted' },
    });
    expect(hostedCheckout.statusCode).toBe(201);
    const hostedBody = hostedCheckout.json() as { orderIds: string[] };

    const nativeCheckout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: nativeToken },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    expect(nativeCheckout.statusCode).toBe(201);
    const nativeBody = nativeCheckout.json() as { orderIds: string[] };

    const hostedOrderBefore = await prisma.order.findUniqueOrThrow({
      where: { id: hostedBody.orderIds[0]! },
    });
    const nativeOrderBefore = await prisma.order.findUniqueOrThrow({
      where: { id: nativeBody.orderIds[0]! },
    });

    // Hosted carries the >= 30-min Stripe Checkout Session window; native
    // keeps the 15-min ORDER_EXPIRY_MS.
    expect(hostedOrderBefore.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(nativeOrderBefore.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000);

    // Simulate the worker's per-minute tick 20 minutes later.
    const twentyMinutesLater = new Date(Date.now() + 20 * 60_000);
    const result = await runOrderExpiryTick({ stripe, now: twentyMinutesLater });

    expect(result.expired).toBe(1);

    const hostedOrderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: hostedBody.orderIds[0]! },
    });
    const nativeOrderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: nativeBody.orderIds[0]! },
    });

    expect(hostedOrderAfter.status).toBe('pending');
    expect(nativeOrderAfter.status).toBe('expired');
  });
});
