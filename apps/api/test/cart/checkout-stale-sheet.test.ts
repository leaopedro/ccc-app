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

describe('folha velha confirmando depois da reabertura do carrinho', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('reembolsa a PI cuja cartVersion nao bate com a do carrinho', async () => {
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
    const before = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });

    // O carrinho reabre e a versao anda. A folha velha ainda segura a PI antiga.
    await prisma.cart.update({
      where: { id: body.checkoutId },
      data: { status: 'open', version: { increment: 1 } },
    });

    stripe.nextEvent = {
      id: 'evt_stale_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: body.providerRef,
          metadata: { cartId: body.checkoutId, cartVersion: String(before.version) },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refunded: true, reason: 'stale-cart-version' });

    const refunds = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refunds).toHaveLength(1);

    // Nenhum pedido pode ter virado pago com estoque ja revendido.
    const paid = await prisma.order.count({ where: { cartId: body.checkoutId, status: 'paid' } });
    expect(paid).toBe(0);
  });

  it('liquida normalmente quando a cartVersion bate', async () => {
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
    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });

    stripe.nextEvent = {
      id: 'evt_fresh_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: body.providerRef,
          metadata: { cartId: body.checkoutId, cartVersion: String(cart.version) },
        },
      },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    const paid = await prisma.order.count({ where: { cartId: body.checkoutId, status: 'paid' } });
    expect(paid).toBeGreaterThan(0);
  });

  // Sessoes hospedadas mintadas antes deste deploy nao tem cartVersion.
  // Recusar por ausencia reembolsaria compras legitimas em voo.
  it('liquida normalmente quando a metadata nao tem cartVersion', async () => {
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
      id: 'evt_legacy_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: body.providerRef, metadata: { cartId: body.checkoutId } } },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    const paid = await prisma.order.count({ where: { cartId: body.checkoutId, status: 'paid' } });
    expect(paid).toBeGreaterThan(0);
  });
});
