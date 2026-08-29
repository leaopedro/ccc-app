import { prisma } from '@ccc/db';
import { beginCheckoutResponseSchema } from '@ccc/shared/cart';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import {
  bearer,
  createUser,
  makeAppWithFakes,
  makeAppWithFakeStripe,
  resetDatabase,
} from '../helpers.js';

const env = loadEnv();

const seedPublishedEvent = async (opts?: {
  quantityTotal?: number;
  priceCents?: number;
  maxTicketsPerUser?: number;
}) => {
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
      maxTicketsPerUser: opts?.maxTicketsPerUser ?? 5,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: opts?.priceCents ?? 5000,
      currency: 'BRL',
      quantityTotal: opts?.quantityTotal ?? 50,
      quantitySold: 0,
    },
  });
  return { event, tier };
};

const addCartItem = async (
  app: FastifyInstance,
  token: string,
  item: {
    eventId: string;
    tierId: string;
    quantity?: number;
    tickets?: Array<{ carId?: string; licensePlate?: string; extras?: string[] }>;
    kind?: 'ticket' | 'extras_only';
  },
) => {
  const tickets = item.tickets ?? [{ extras: [] }];
  const res = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: token },
    payload: {
      item: {
        eventId: item.eventId,
        tierId: item.tierId,
        source: 'purchase',
        kind: item.kind ?? 'ticket',
        quantity: item.quantity ?? 1,
        tickets,
      },
    },
  });
  expect(res.statusCode).toBe(200);
  const json: unknown = res.json();
  return json;
};

describe('POST /cart/checkout — flow native', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('devolve clientSecret e checkoutUrl nulo', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });

    expect(res.statusCode).toBe(201);
    const body = beginCheckoutResponseSchema.parse(res.json());
    expect(body.clientSecret).toBe('pi_test_1_secret_abc');
    expect(body.checkoutUrl).toBeNull();
    expect(body.provider).toBe('stripe');
    expect(body.providerRef).toBe('pi_test_1');
  });

  it('carimba providerRef no pedido canonico', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });

    const body = beginCheckoutResponseSchema.parse(res.json());
    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderIds[0]! } });
    expect(order.providerRef).toBe('pi_test_1');
  });

  // Sem esta metadata o webhook nao resolve o carrinho e a PI paga fica orfa.
  it('carrega a mesma metadata que o webhook de carrinho ja le', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = beginCheckoutResponseSchema.parse(res.json());

    const call = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    expect(call).toBeDefined();
    const payload = call!.payload as {
      metadata: Record<string, string>;
      receiptEmail?: string;
    };
    expect(payload.metadata.cartId).toBe(body.checkoutId);
    expect(payload.metadata.userId).toBe(user.id);
    expect(JSON.parse(payload.metadata.orderIds!)).toEqual(body.orderIds);
    expect(payload.metadata.cartVersion).toBeDefined();
  });

  // Aceitar receipt_email do corpo seria primitiva de e-mail para destinatario
  // arbitrario assinada pela nossa conta Stripe.
  it('deriva receipt_email do usuario autenticado e ignora o corpo', async () => {
    const { user } = await createUser({ verified: true, email: 'dono@casacar.test' });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: {
        paymentMethod: 'card',
        flow: 'native',
        receiptEmail: 'atacante@evil.test',
        receipt_email: 'atacante@evil.test',
      },
    });

    const call = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    const payload = call!.payload as { receiptEmail?: string };
    expect(payload.receiptEmail).toBe('dono@casacar.test');
  });

  it('o default continua hospedado: sem flow, devolve checkoutUrl', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card' },
    });

    const body = beginCheckoutResponseSchema.parse(res.json());
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');
    expect(body.clientSecret).toBeNull();
  });

  it('pix ignora flow e continua devolvendo brCode', async () => {
    await app.close();
    let abacatepay: FakeAbacatePay;
    ({ app, abacatepay } = await makeAppWithFakes());

    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    abacatepay.nextBilling = {
      id: 'pix_native_test',
      brCode: '00020126...nativepix',
      amount: 5500,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      status: 'PENDING',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'pix', flow: 'native' },
    });

    expect(res.statusCode).toBe(201);
    const body = beginCheckoutResponseSchema.parse(res.json());
    expect(body.provider).toBe('abacatepay');
    expect(body.brCode).toBe('00020126...nativepix');
    expect(body.checkoutUrl).toBeNull();
    expect(body.clientSecret).toBeNull();
  });
});
