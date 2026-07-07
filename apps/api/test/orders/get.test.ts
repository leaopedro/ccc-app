import { prisma } from '@jdm/db';
import { getOrderResponseSchema } from '@jdm/shared/orders';
import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  init: vi.fn(),
  withScope: vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
    callback({ setTag: vi.fn() }),
  ),
}));

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedPublishedEvent = async (quantityTotal = 10) => {
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
      capacity: quantityTotal,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

describe('GET /orders/:id', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with a live pending order unchanged', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_live',
        status: 'pending',
        expiresAt,
      },
    });
    await prisma.ticketTier.update({ where: { id: tier.id }, data: { quantitySold: 1 } });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = getOrderResponseSchema.parse(res.json());
    expect(body.status).toBe('pending');
    expect(body.orderId).toBe(order.id);
    expect(body.provider).toBe('stripe');
    expect(body.amountCents).toBe(5000);
    expect(body.currency).toBe('BRL');
    expect(body.ticketId).toBeUndefined();

    // no expiry side-effect
    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(1);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(0);
  });

  it('lazily expires an overdue pending order and releases capacity', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(1);
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_stale',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.ticketTier.update({ where: { id: tier.id }, data: { quantitySold: 1 } });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = getOrderResponseSchema.parse(res.json());
    expect(body.status).toBe('expired');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const cancelCalls = stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent');
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.payload).toMatchObject({ paymentIntentId: 'pi_stale' });
  });

  it('captures Sentry when lazy-expiry Stripe cancel fails', async () => {
    const cancelErr = new Error('stripe cancel failed');
    stripe.cancelPaymentIntent = (paymentIntentId) => {
      stripe.calls.push({ kind: 'cancelPaymentIntent', payload: { paymentIntentId } });
      return Promise.reject(cancelErr);
    };

    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(1);
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_stale_capture',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.ticketTier.update({ where: { id: tier.id }, data: { quantitySold: 1 } });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledWith(cancelErr);
    });
  });

  it('returns 404 when order does not exist', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/orders/nonexistent-id',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when the order belongs to a different user', async () => {
    const { user } = await createUser({ verified: true });
    const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });
    const { event, tier } = await seedPublishedEvent();
    const order = await prisma.order.create({
      data: {
        userId: other.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orders/some-id',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns paid + ticketId after Stripe webhook flips order to paid', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_paid_flow',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    await prisma.ticketTier.update({ where: { id: tier.id }, data: { quantitySold: 1 } });

    // 1st poll: pending, no ticketId
    const pre = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(pre.statusCode).toBe(200);
    const preBody = getOrderResponseSchema.parse(pre.json());
    expect(preBody.status).toBe('pending');
    expect(preBody.ticketId).toBeUndefined();

    // Drive the existing webhook handler to flip to paid + issue ticket.
    stripe.nextEvent = {
      id: 'evt_get_paid_flow',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };
    const webhookRes = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: Buffer.from(JSON.stringify(stripe.nextEvent)),
    });
    expect(webhookRes.statusCode).toBe(200);

    // 2nd poll: paid + ticketId
    const post = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(post.statusCode).toBe(200);
    const paid = getOrderResponseSchema.parse(post.json());
    expect(paid.status).toBe('paid');
    expect(paid.ticketId).toBeDefined();

    const dbTicket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    expect(paid.ticketId).toBe(dbTicket.id);
  });

  it('rate-limits the poller after 60 hits/minute/user', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    let last = 200;
    for (let i = 0; i < 65; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/orders/${order.id}`,
        headers: { authorization: bearer(env, user.id) },
      });
      last = res.statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
