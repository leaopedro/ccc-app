import { prisma } from '@jdm/db';
import { createOrderResponseSchema } from '@jdm/shared/orders';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();
const errorResponseSchema = z.object({ error: z.string(), message: z.string().optional() });
const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const seedPublishedEvent = async () => {
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
      capacity: 100,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 100,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

const seedExtra = async (eventId: string, opts?: { priceCents?: number }) => {
  return prisma.ticketExtra.create({
    data: {
      eventId,
      name: `Extra-${Math.random().toString(36).slice(2, 6)}`,
      priceCents: opts?.priceCents ?? 2000,
      currency: 'BRL',
      quantityTotal: 10,
      quantitySold: 0,
      sortOrder: 0,
    },
  });
};

const seedExistingTicket = async (userId: string, eventId: string, tierId: string) => {
  return prisma.ticket.create({
    data: { userId, eventId, tierId, source: 'purchase', status: 'valid' },
  });
};

describe('POST /orders — extras-only flow', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates extras-only order when user has existing ticket and includes extras', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id, { priceCents: 3000 });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    expect(body.amountCents).toBe(3300);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.kind).toBe('extras_only');
    expect(order.status).toBe('pending');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);
  });

  it('rejects extrasOnly when user has no existing ticket (422)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const extra = await seedExtra(event.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('rejects extras-only order with zero extras (422)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await seedExistingTicket(user.id, event.id, tier.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [] }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('rejects duplicate extra already attached to existing ticket (409)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const ticket = await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id);

    await prisma.ticketExtraItem.create({
      data: { ticketId: ticket.id, extraId: extra.id, code: 'existing_code', status: 'valid' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('Conflict');
    expect(stripe.calls).toHaveLength(0);
  });

  it('reserves extras stock for extras-only order', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(201);
    const reloaded = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
    expect(reloaded.quantitySold).toBe(1);
  });

  it('webhook idempotent: extras-only order does not create duplicate TicketExtraItem rows', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const ticket = await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'extras_only',
        amountCents: 2000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_extras_test',
        status: 'pending',
      },
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 1 },
    });

    const { issueTicketForPaidOrder } = await import('../../src/services/tickets/issue.js');

    const result = await issueTicketForPaidOrder(order.id, 'pi_extras_test', env);
    expect(result.ticketId).toBe(ticket.id);

    const result2 = await issueTicketForPaidOrder(order.id, 'pi_extras_test', env);
    expect(result2.ticketId).toBe(ticket.id);

    const items = await prisma.ticketExtraItem.findMany({
      where: { ticketId: ticket.id, extraId: extra.id },
    });
    expect(items).toHaveLength(1);
  });

  it('webhook success: extras-only order creates TicketExtraItem without new Ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const ticket = await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'extras_only',
        amountCents: 2000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_extras_wh',
        status: 'pending',
      },
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 1 },
    });

    stripe.nextEvent = {
      id: 'evt_extras_success',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_extras_wh', metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const tickets = await prisma.ticket.findMany({ where: { userId: user.id, eventId: event.id } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.id).toBe(ticket.id);

    const items = await prisma.ticketExtraItem.findMany({ where: { ticketId: ticket.id } });
    expect(items).toHaveLength(1);
    expect(items[0]!.extraId).toBe(extra.id);
    expect(items[0]!.status).toBe('valid');

    const refunds = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refunds).toHaveLength(0);
  });

  it('payment_failed: extras-only order releases extras stock but not tier capacity', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'extras_only',
        amountCents: 2000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_extras_fail',
        status: 'pending',
      },
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 1 },
    });
    await prisma.ticketExtra.update({
      where: { id: extra.id },
      data: { quantitySold: 1 },
    });

    stripe.nextEvent = {
      id: 'evt_extras_fail',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_extras_fail', metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('failed');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const reloadedExtra = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
    expect(reloadedExtra.quantitySold).toBe(0);
  });

  it('extras-only order on requiresCar tier succeeds without carId', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await prisma.ticketTier.update({ where: { id: tier.id }, data: { requiresCar: true } });
    await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id, { priceCents: 1500 });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    expect(body.amountCents).toBe(1650);
  });

  it('expiry: extras-only order does not decrement tier quantitySold', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await seedExistingTicket(user.id, event.id, tier.id);
    const extra = await seedExtra(event.id);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'extras_only',
        amountCents: 2000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_extras_exp',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 1 },
    });
    await prisma.ticketExtra.update({
      where: { id: extra.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'expired' });

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const reloadedExtra = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
    expect(reloadedExtra.quantitySold).toBe(0);
  });
});
