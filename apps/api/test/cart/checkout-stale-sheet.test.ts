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

  // O andar completo do bug F1: a folha velha nao so e um no-op, o
  // charge.refunded que ELA MESMA gera nao pode revogar a compra seguinte.
  //
  //   1. Carrinho C v1, checkout nativo -> O1 com providerRef = PI-A.
  //   2. Cartao recusa: handleCartFailure marca O1 'failed' (mantendo
  //      providerRef = PI-A) e reabre o carrinho em v2.
  //   3. O cancel best-effort da PI-A perde a corrida (nao simulado aqui, so
  //      nao importa mais). Usuario re-tenta -> O2 com providerRef = PI-B. O
  //      updateMany que zera providerRef antes de estampar so pega
  //      status:'pending', entao O1 continua com PI-A.
  //   4. PI-B liquida: O2 pago, ticket emitido.
  //   5. A folha velha confirma PI-A. cartVersion da PI-A (v1) diverge da
  //      atual (v2) -> guarda de folha velha reembolsa PI-A.
  //   6. Stripe manda charge.refunded para PI-A. O anchor (O1) NAO esta
  //      'paid' (esta 'failed'), entao o cascade por cartId nao deve tocar em
  //      O2 nem no ticket que ele emitiu.
  it('charge.refunded da folha velha nao revoga o pedido pago por uma segunda tentativa', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    // 1. Checkout nativo -> O1 / PI-A.
    stripe.nextPaymentIntent = { id: 'pi_A', clientSecret: 'pi_A_secret' };
    const checkout1 = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    expect(checkout1.statusCode).toBe(201);
    const body1 = checkout1.json() as {
      checkoutId: string;
      providerRef: string;
      orderIds: string[];
    };
    expect(body1.providerRef).toBe('pi_A');
    const cartId = body1.checkoutId;
    const o1Id = body1.orderIds[0]!;
    const cartAtV1 = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } });

    // 2. Cartao recusa.
    stripe.nextEvent = {
      id: 'evt_fail_A',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_A', metadata: { cartId } } },
    };
    const failRes = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    expect(failRes.statusCode).toBe(200);

    const o1AfterFail = await prisma.order.findUniqueOrThrow({ where: { id: o1Id } });
    expect(o1AfterFail.status).toBe('failed');
    expect(o1AfterFail.providerRef).toBe('pi_A');

    // 3. Re-tentativa -> O2 / PI-B. O1 mantem PI-A (nao esta mais pending).
    stripe.nextPaymentIntent = { id: 'pi_B', clientSecret: 'pi_B_secret' };
    const checkout2 = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    expect(checkout2.statusCode).toBe(201);
    const body2 = checkout2.json() as { providerRef: string; orderIds: string[] };
    expect(body2.providerRef).toBe('pi_B');
    const o2Id = body2.orderIds[0]!;

    const o1AfterRetry = await prisma.order.findUniqueOrThrow({ where: { id: o1Id } });
    expect(o1AfterRetry.providerRef).toBe('pi_A');

    // 4. PI-B liquida: O2 pago, ticket emitido.
    const cartAtV2 = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } });
    stripe.nextEvent = {
      id: 'evt_pay_B',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_B', metadata: { cartId, cartVersion: String(cartAtV2.version) } },
      },
    };
    const payRes = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    expect(payRes.statusCode).toBe(200);

    const o2AfterPay = await prisma.order.findUniqueOrThrow({ where: { id: o2Id } });
    expect(o2AfterPay.status).toBe('paid');

    const ticketBefore = await prisma.ticket.findFirst({ where: { userId: user.id } });
    expect(ticketBefore).not.toBeNull();
    expect(ticketBefore!.status).toBe('valid');

    // 5. Folha velha confirma PI-A: cartVersion v1 diverge da atual (v2) ->
    // reembolsada.
    stripe.nextEvent = {
      id: 'evt_stale_A',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_A', metadata: { cartId, cartVersion: String(cartAtV1.version) } },
      },
    };
    const staleRes = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    expect(staleRes.statusCode).toBe(200);
    expect(staleRes.json()).toMatchObject({ refunded: true, reason: 'stale-cart-version' });

    const refundCalls = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]!.payload).toMatchObject({ paymentIntentId: 'pi_A' });

    // 6. charge.refunded chega para a PI-A que acabou de ser reembolsada. O1
    // (o anchor resolvido por providerRef) esta 'failed', nao 'paid' -- o
    // cascade por cartId NAO pode tocar em O2.
    stripe.nextEvent = {
      id: 'evt_charge_refunded_A',
      type: 'charge.refunded',
      data: {
        object: {
          payment_intent: 'pi_A',
          amount: o1AfterFail.amountCents,
          amount_refunded: o1AfterFail.amountCents,
        },
      },
    };
    const chargeRes = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    expect(chargeRes.statusCode).toBe(200);

    const o2AfterRefundEvent = await prisma.order.findUniqueOrThrow({ where: { id: o2Id } });
    expect(o2AfterRefundEvent.status).toBe('paid');

    const ticketAfter = await prisma.ticket.findFirst({ where: { userId: user.id } });
    expect(ticketAfter).not.toBeNull();
    expect(ticketAfter!.status).toBe('valid');
  });
});
