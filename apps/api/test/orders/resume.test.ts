import { prisma } from '@jdm/db';
import { resumeOrderResponseSchema } from '@jdm/shared/orders';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import {
  bearer,
  createUser,
  makeAppWithFakeStripe,
  makeAppWithFakes,
  resetDatabase,
} from '../helpers.js';

const env = loadEnv();

const seedEvent = async () => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 10,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 10,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

describe('GET /orders/:id/resume', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let abacatepay: FakeAbacatePay;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe, abacatepay } = await makeAppWithFakes());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with brCode for a pending PIX order', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'pix_char_abc',
        brCode: '00020126580014br.gov.bcb.pix...test',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = resumeOrderResponseSchema.parse(res.json());
    expect(body.method).toBe('pix');
    if (body.method === 'pix') {
      expect(body.orderId).toBe(order.id);
      expect(body.brCode).toBe('00020126580014br.gov.bcb.pix...test');
      expect(body.amountCents).toBe(5000);
      expect(body.currency).toBe('BRL');
    }
    // AbacatePay not called — brCode comes from DB
    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(0);
  });

  it('returns 200 with clientSecret for a pending Stripe order', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_test_resume',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    stripe.nextRetrievedPaymentIntent = {
      id: 'pi_test_resume',
      clientSecret: 'pi_test_resume_secret_xyz',
    };

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = resumeOrderResponseSchema.parse(res.json());
    expect(body.method).toBe('card');
    if (body.method === 'card') {
      expect(body.orderId).toBe(order.id);
      expect(body.clientSecret).toBe('pi_test_resume_secret_xyz');
      expect(body.amountCents).toBe(5000);
    }
    const retrieveCalls = stripe.calls.filter((c) => c.kind === 'retrievePaymentIntent');
    expect(retrieveCalls).toHaveLength(1);
    expect(retrieveCalls[0]?.payload).toMatchObject({ paymentIntentId: 'pi_test_resume' });
  });

  it('returns 409 OrderNotPending when order is expired by TTL (lazy expiry)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        brCode: 'br.gov.bcb.pix...test',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    // Lazy expiry releases the legacy /orders tier reservation; mirror the
    // route invariant (tier is incremented when the Order row is created).
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'OrderNotPending' });
  });

  it('returns 409 OrderNotPending for a paid order', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_paid',
        status: 'paid',
        paidAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'OrderNotPending', status: 'paid' });
  });

  it('returns 404 for a non-existent order', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/orders/nonexistent-id/resume',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the order belongs to a different user', async () => {
    const { user } = await createUser({ verified: true });
    const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });
    const { event, tier } = await seedEvent();
    const order = await prisma.order.create({
      data: {
        userId: other.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        brCode: 'br.gov.bcb.pix...other',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orders/any-id/resume',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /orders/:id/resume — brCode recovery', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, abacatepay } = await makeAppWithFakes());
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a fresh billing and returns 200 when brCode is null (cart-checkout orders)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    // Simulate an order created via cart PIX checkout before the brCode fix —
    // providerRef is set but brCode was never stored.
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 7500,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'old_billing_id',
        brCode: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    abacatepay.nextBilling = {
      id: 'new_billing_id',
      brCode: '00020126...recovered',
      amount: 7500,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      status: 'PENDING',
    };

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = resumeOrderResponseSchema.parse(res.json());
    expect(body.method).toBe('pix');
    if (body.method === 'pix') {
      expect(body.brCode).toBe('00020126...recovered');
      expect(body.amountCents).toBe(7500);
    }

    // New billing was created
    const billingCalls = abacatepay.calls.filter((c) => c.method === 'createPixBilling');
    expect(billingCalls).toHaveLength(1);

    // Order row updated with new providerRef and brCode
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.brCode).toBe('00020126...recovered');
    expect(updated.providerRef).toBe('new_billing_id');
  });

  it('returns 503 when brCode is null and abacatepay is not configured', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'old_billing_id',
        brCode: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    // Build app without AbacatePay configured
    await app.close();
    const { app: appNoAbacate } = await makeAppWithFakeStripe();

    const res = await appNoAbacate.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ServiceUnavailable' });

    await appNoAbacate.close();
  });
});

describe('POST /orders (PIX) — brCode persistence', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, abacatepay } = await makeAppWithFakes());
  });

  afterEach(async () => {
    await app.close();
  });

  it('saves brCode on the order row after PIX billing creation', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEvent();
    abacatepay.nextBilling = {
      id: 'pix_char_saved',
      brCode: '00020126...saved',
      amount: 5000,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      status: 'PENDING',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id), 'content-type': 'application/json' },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        method: 'pix',
        extrasOnly: false,
        tickets: [{ extras: [] }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ orderId: string }>();
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(saved.brCode).toBe('00020126...saved');
  });
});
