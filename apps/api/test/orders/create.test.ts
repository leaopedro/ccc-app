import { prisma } from '@ccc/db';
import { createOrderResponseSchema } from '@ccc/shared/orders';
import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const errorResponseSchema = z.object({ error: z.string(), message: z.string().optional() });

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
import type { CreatePaymentIntentInput } from '../../src/services/stripe/index.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedPublishedEvent = async (quantityTotal = 10, opts?: { requiresCar?: boolean }) => {
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
      requiresCar: opts?.requiresCar ?? false,
    },
  });
  return { event, tier };
};

const seedExtra = async (
  eventId: string,
  opts?: { quantitySold?: number; quantityTotal?: number },
) => {
  return prisma.ticketExtra.create({
    data: {
      eventId,
      name: 'Camiseta',
      priceCents: 2000,
      currency: 'BRL',
      quantityTotal: opts?.quantityTotal ?? 10,
      quantitySold: opts?.quantitySold ?? 0,
      sortOrder: 0,
    },
  });
};

describe('POST /orders', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a pending order, bumps quantitySold, and returns clientSecret', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    expect(body.status).toBe('pending');
    // 5000 base + 10% dev fee = 5500 gross. Default DEV_FEE_PERCENT is 10.
    expect(body.amountCents).toBe(5500);
    expect(body.baseAmountCents).toBe(5000);
    expect(body.devFeePercent).toBe(10);
    expect(body.devFeeAmountCents).toBe(500);
    expect(body.clientSecret).toBe('pi_test_1_secret_abc');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.status).toBe('pending');
    expect(order.providerRef).toBe('pi_test_1');
    expect(order.amountCents).toBe(5500);
    expect(order.baseAmountCents).toBe(5000);
    expect(order.devFeePercent).toBe(10);
    expect(order.devFeeAmountCents).toBe(500);

    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(1);

    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0]!.kind).toBe('createPaymentIntent');
  });

  it('reserves N tier capacity slots for an N-ticket order (JDMA-267)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(10);
    await prisma.event.update({
      where: { id: event.id },
      data: { maxTicketsPerUser: 5 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}, {}, {}],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    // 3 × 5000 base + 10% dev fee = 16500 gross.
    expect(body.amountCents).toBe(16500);
    expect(body.baseAmountCents).toBe(15000);
    expect(body.devFeeAmountCents).toBe(1500);

    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(3);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.quantity).toBe(3);
  });

  it('rejects multi-ticket order when remaining tier capacity < tickets.length', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(2);
    await prisma.event.update({
      where: { id: event.id },
      data: { maxTicketsPerUser: 10 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}, {}, {}],
      },
    });

    expect(res.statusCode).toBe(409);
    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(0);
  });

  it('422 when tickets.length exceeds event.maxTicketsPerUser (JDMA-267)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(10);
    await prisma.event.update({
      where: { id: event.id },
      data: { maxTicketsPerUser: 2 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}, {}, {}],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'UnprocessableEntity' });

    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(0);
  });

  it('allows repurchase: user with existing ticket creates new ticket order', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    // 5000 base + 10% dev fee = 5500 gross.
    expect(body.amountCents).toBe(5500);
    expect(body.baseAmountCents).toBe(5000);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.kind).toBe('ticket');

    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(1);
  });

  it('creates order with extras: computes total and stores OrderExtra rows', async () => {
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
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    // 5000 (tier) + 2000 (extra) = 7000 base; gross with 10% dev fee = 7700.
    expect(body.amountCents).toBe(7700);
    expect(body.baseAmountCents).toBe(7000);
    expect(body.devFeeAmountCents).toBe(700);

    const orderExtra = await prisma.orderExtra.findFirst({ where: { orderId: body.orderId } });
    expect(orderExtra).not.toBeNull();
    expect(orderExtra?.extraId).toBe(extra.id);

    const reloadedExtra = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
    expect(reloadedExtra.quantitySold).toBe(1);

    // Stripe PI metadata should carry tickets JSON
    const piCall = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    const piPayload = piCall!.payload as CreatePaymentIntentInput;
    expect(piPayload.metadata?.tickets).toBeDefined();
    const tickets = JSON.parse(piPayload.metadata.tickets as string) as unknown[];
    expect(tickets).toHaveLength(1);
    expect((tickets[0] as { e: string[] }).e).toContain(extra.id);
  });

  it('Stripe PI amountCents is gross (dev-fee-inclusive) when extras are included', async () => {
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
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    // 5000 (tier base) + 2000 (extra base) = 7000 base; gross with 10% dev fee = 7700.
    expect(body.amountCents).toBe(7700);
    expect(body.baseAmountCents).toBe(7000);

    const piCall = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    const piPayload = piCall!.payload as CreatePaymentIntentInput;
    // Provider must be billed the gross amount, not the base amount.
    expect(piPayload.amountCents).toBe(7700);
  });

  it('returns 422 when the same extra appears twice in one ticket', async () => {
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
        tickets: [{ extras: [extra.id, extra.id] }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 409 when an extra is sold out', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const extra = await seedExtra(event.id, { quantityTotal: 1, quantitySold: 1 });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('Conflict');
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 404 when an extra does not belong to the event', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const { event: otherEvent } = await seedPublishedEvent();
    const foreignExtra = await seedExtra(otherEvent.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ extras: [foreignExtra.id] }],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 422 when tier requiresCar but carId is missing', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(10, { requiresCar: true });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('rejects requiresCar tier when extras-only ticket omits car data', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(10, { requiresCar: true });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ extras: [] }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
  });

  it('succeeds when tier requiresCar and user owns the car with valid plate', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(10, { requiresCar: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 2020, nickname: 'Civic' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ carId: car.id, licensePlate: 'ABC-1234' }],
      },
    });

    expect(res.statusCode).toBe(201);
    // Stripe metadata should carry carId
    const piCall = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    const piPayload2 = piCall!.payload as CreatePaymentIntentInput;
    const tickets = JSON.parse(piPayload2.metadata.tickets as string) as unknown[];
    expect((tickets[0] as { c: string }).c).toBe(car.id);
  });

  it('returns 409 when the tier is sold out', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(1);
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });

    expect(res.statusCode).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('Conflict');
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 422 when extrasOnly is true but no extras provided', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await prisma.ticket.create({
      data: { userId: user.id, eventId: event.id, tierId: tier.id, source: 'comp' },
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
        tickets: [{}],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 404 when the event is not published', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await prisma.event.update({ where: { id: event.id }, data: { status: 'draft' } });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the tier does not belong to the event', async () => {
    const { user } = await createUser({ verified: true });
    const { event } = await seedPublishedEvent();
    const otherEvent = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: otherEvent.tier.id, method: 'card', tickets: [{}] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const { event, tier } = await seedPublishedEvent();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 for Pix when AbacatePay not configured', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'pix', tickets: [{}] },
    });
    expect(res.statusCode).toBe(503);
  });

  it('rolls back tier and extra stock when Pix returns 503 (provider not configured)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const extra = await seedExtra(event.id);

    const tierBefore = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    const extraBefore = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'pix',
        tickets: [{ extras: [extra.id] }],
      },
    });

    expect(res.statusCode).toBe(503);

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    const extraAfter = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });

    expect(tierAfter.quantitySold).toBe(tierBefore.quantitySold);
    expect(extraAfter.quantitySold).toBe(extraBefore.quantitySold);
  });

  it('sweeps expired pending orders and reclaims capacity before reserving', async () => {
    const { user } = await createUser({ verified: true });
    const { user: user2 } = await createUser({ email: 'user2@jdm.test', verified: true });
    const { event, tier } = await seedPublishedEvent(1);

    await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_abandoned',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user2.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });

    expect(res.statusCode).toBe(201);

    const abandoned = await prisma.order.findFirst({
      where: { userId: user.id, eventId: event.id },
    });
    expect(abandoned?.status).toBe('expired');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(1);

    const cancelCalls = stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent');
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.payload).toMatchObject({ paymentIntentId: 'pi_abandoned' });
  });

  it('captures Sentry when sweep-triggered Stripe cancel fails during order creation', async () => {
    const cancelErr = new Error('stripe cancel failed');
    stripe.cancelPaymentIntent = (paymentIntentId) => {
      stripe.calls.push({ kind: 'cancelPaymentIntent', payload: { paymentIntentId } });
      return Promise.reject(cancelErr);
    };

    const { user } = await createUser({ verified: true });
    const { user: user2 } = await createUser({ email: 'user2@jdm.test', verified: true });
    const { event, tier } = await seedPublishedEvent(1);

    await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_abandoned_capture',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user2.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
    });

    expect(res.statusCode).toBe(201);
    await vi.waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledWith(cancelErr);
    });
  });

  // JDMA-485: block second checkout while user has live pending ticket order for same event.
  describe('pending ticket order guard (JDMA-485)', () => {
    it('409 PENDING_TICKET_ORDER_FOR_EVENT when user has a live pending order for same event', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      const first = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
      });
      expect(second.statusCode).toBe(409);
      const body = errorResponseSchema.extend({ code: z.string().optional() }).parse(second.json());
      expect(body.code).toBe('PENDING_TICKET_ORDER_FOR_EVENT');

      const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(reloaded.quantitySold).toBe(1);
    });

    it('allows checkout for a different event while pending exists for another', async () => {
      const { user } = await createUser({ verified: true });
      const { event: ev1, tier: tier1 } = await seedPublishedEvent();
      const { event: ev2, tier: tier2 } = await seedPublishedEvent();

      const first = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: ev1.id, tierId: tier1.id, method: 'card', tickets: [{}] },
      });
      expect(first.statusCode).toBe(201);

      stripe.nextPaymentIntent = { id: 'pi_test_2', clientSecret: 'pi_test_2_secret_abc' };
      const second = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: ev2.id, tierId: tier2.id, method: 'card', tickets: [{}] },
      });
      expect(second.statusCode).toBe(201);
    });

    it('allows checkout after the previous pending order has expired', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      const first = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
      });
      expect(first.statusCode).toBe(201);
      const firstBody = createOrderResponseSchema.parse(first.json());

      await prisma.order.update({
        where: { id: firstBody.orderId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      stripe.nextPaymentIntent = { id: 'pi_test_2', clientSecret: 'pi_test_2_secret_abc' };
      const second = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
      });
      expect(second.statusCode).toBe(201);
    });

    it('allows extras_only checkout while user has pending ticket order', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();
      const extra = await seedExtra(event.id);

      // user must already own a valid ticket for extras_only to be permitted.
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });

      const first = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: bearer(env, user.id) },
        payload: { eventId: event.id, tierId: tier.id, method: 'card', tickets: [{}] },
      });
      expect(first.statusCode).toBe(201);

      stripe.nextPaymentIntent = { id: 'pi_test_2', clientSecret: 'pi_test_2_secret_abc' };
      const extrasOnlyRes = await app.inject({
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
      expect(extrasOnlyRes.statusCode).toBe(201);
    });
  });
});
