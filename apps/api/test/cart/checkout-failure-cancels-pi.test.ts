import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

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
  return res.json() as unknown;
};

describe('handleCartFailure cancela a PaymentIntent', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('cancela a PI e reabre o carrinho no payment_intent.payment_failed', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };

    stripe.nextEvent = {
      id: 'evt_failed_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: body.providerRef, metadata: { cartId: body.checkoutId } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(200);

    const cancels = stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.payload).toMatchObject({ paymentIntentId: body.providerRef });

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });
    expect(cart.status).toBe('open');
  });

  // O cancel e best-effort. Uma PI que a Stripe ja fechou 400a no cancel, e
  // deixar esse erro escapar faria a Stripe reentregar o evento por ~3 dias
  // contra um carrinho que ja foi reaberto corretamente.
  it('nao falha o webhook quando o cancel da Stripe estoura', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };

    stripe.nextCancelPaymentIntentError = new Error('payment_intent_unexpected_state');
    stripe.nextEvent = {
      id: 'evt_failed_2',
      type: 'payment_intent.payment_failed',
      data: { object: { id: body.providerRef, metadata: { cartId: body.checkoutId } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(200);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });
    expect(cart.status).toBe('open');
  });
});
