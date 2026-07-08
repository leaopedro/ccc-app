/**
 * JDMA-150: car/plate validation on order creation + webhook persistence + check-in enrichment
 */
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import type { CreatePaymentIntentInput } from '../../src/services/stripe/index.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();
const errorResponseSchema = z.object({ error: z.string(), message: z.string().optional() });

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const seedEventWithCarTier = async () => {
  const event = await prisma.event.create({
    data: {
      slug: `car-ev-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Car Event',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'drift',
      status: 'published',
      capacity: 10,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Driver',
      priceCents: 5000,
      quantityTotal: 10,
      sortOrder: 0,
      requiresCar: true,
    },
  });
  return { event, tier };
};

const seedCar = async (userId: string, nickname = 'Supra') =>
  prisma.car.create({
    data: {
      userId,
      make: 'Toyota',
      model: 'Supra',
      year: 1994,
      nickname,
    },
  });

// ── Plate format validation ────────────────────────────────────────────────────

describe('POST /orders — plate format validation', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(() => app.close());

  it.each([
    'ABC-1234', // old Mercosul style
    'ABC1D23', // new Mercosul (no dash)
    'ABC-1A23', // new Mercosul with dash
  ])('accepts valid plate "%s"', async (plate) => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventWithCarTier();
    const car = await seedCar(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ carId: car.id, licensePlate: plate }],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it.each([
    'abc-1234', // lowercase
    'AB-1234', // too short prefix
    'ABCD-1234', // too long prefix
    'ABC-123', // too short suffix
    'ABC-12345', // too long suffix
    'ABC-12##', // invalid chars
    'ABC 1234', // space instead of dash/no separator
  ])('rejects invalid plate "%s" with 400', async (plate) => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventWithCarTier();
    const car = await seedCar(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ carId: car.id, licensePlate: plate }],
      },
    });

    // Plate format is validated by the shared Zod schema -> ZodError -> 400 ValidationError
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
    expect(stripe.calls).toHaveLength(0);
  });
});

// ── Car ownership guard ────────────────────────────────────────────────────────

describe('POST /orders — car ownership guard', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(() => app.close());

  it('returns 422 when carId belongs to a different user', async () => {
    const { user } = await createUser({ verified: true });
    const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });
    const { event, tier } = await seedEventWithCarTier();
    const otherCar = await seedCar(other.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ carId: otherCar.id, licensePlate: 'ABC-1234' }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 422 when carId does not exist', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventWithCarTier();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ carId: 'nonexistent-car-id', licensePlate: 'ABC-1234' }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 422 when licensePlate is missing on a requiresCar tier', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventWithCarTier();
    const car = await seedCar(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ carId: car.id }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('UnprocessableEntity');
    expect(stripe.calls).toHaveLength(0);
  });

  it('succeeds when user owns the car and plate is valid', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventWithCarTier();
    const car = await seedCar(user.id);

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

    // Stripe metadata carries c/p per ticket
    const piCall = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    const piPayload = piCall!.payload as CreatePaymentIntentInput;
    const tickets = JSON.parse(piPayload.metadata.tickets as string) as unknown[];
    expect((tickets[0] as { c: string }).c).toBe(car.id);
    expect((tickets[0] as { p: string }).p).toBe('ABC-1234');
  });
});

// ── Webhook persistence ────────────────────────────────────────────────────────

describe('POST /stripe/webhook — car/plate persistence', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(() => app.close());

  it('persists carId and licensePlate from Stripe metadata to the issued Ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventWithCarTier();
    const car = await seedCar(user.id);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_car_test',
        status: 'pending',
      },
    });

    const ticketsMeta = JSON.stringify([{ e: [], c: car.id, p: 'ABC-1234' }]);
    stripe.nextEvent = {
      id: 'evt_car_persist',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: order.providerRef,
          metadata: { orderId: order.id, tickets: ticketsMeta },
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

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    expect(ticket.carId).toBe(car.id);
    expect(ticket.licensePlate).toBe('ABC-1234');
  });

  it('issues ticket without car fields when metadata has none', async () => {
    const { user } = await createUser({ verified: true });
    const event = await prisma.event.create({
      data: {
        slug: `no-car-ev-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Regular Event',
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
        requiresCar: false,
      },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_no_car_test',
        status: 'pending',
      },
    });

    stripe.nextEvent = {
      id: 'evt_no_car',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: order.providerRef,
          metadata: { orderId: order.id },
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

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    expect(ticket.carId).toBeNull();
    expect(ticket.licensePlate).toBeNull();
  });
});

// ── Check-in response enrichment ───────────────────────────────────────────────

describe('POST /admin/tickets/check-in — car data in response', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(() => app.close());

  it('includes car make/model/year and licensePlate when ticket has car', async () => {
    const { user: holder } = await createUser({ email: 'h-car@jdm.test', verified: true });
    const { user: actor } = await createUser({
      email: 'a-car@jdm.test',
      verified: true,
      role: 'staff',
    });
    const car = await seedCar(holder.id);

    const event = await prisma.event.create({
      data: {
        slug: `car-checkin-ev-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Drift Event',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'SP',
        stateCode: 'SP',
        type: 'drift',
        status: 'published',
        publishedAt: new Date(),
        capacity: 10,
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Driver',
        priceCents: 5000,
        quantityTotal: 10,
        sortOrder: 0,
        requiresCar: true,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId: holder.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        carId: car.id,
        licensePlate: 'ABC-1234',
      },
    });
    const code = signTicketCode(ticket.id, env);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code, eventId: event.id },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      result: string;
      ticket: {
        car: {
          make: string;
          model: string;
          year: number;
          isPremiumActive: boolean;
        } | null;
        licensePlate: string | null;
      };
    }>();
    expect(body.ticket.car).toEqual({
      make: 'Toyota',
      model: 'Supra',
      year: 1994,
      isPremiumActive: false,
    });
    expect(body.ticket.licensePlate).toBe('ABC-1234');
  });

  it('returns null car and licensePlate when ticket has no car', async () => {
    const { user: holder } = await createUser({ email: 'h-nocar@jdm.test', verified: true });
    const { user: actor } = await createUser({
      email: 'a-nocar@jdm.test',
      verified: true,
      role: 'staff',
    });

    const event = await prisma.event.create({
      data: {
        slug: `nocar-checkin-ev-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Regular Event',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        publishedAt: new Date(),
        capacity: 10,
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 1000,
        quantityTotal: 10,
        sortOrder: 0,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId: holder.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
      },
    });
    const code = signTicketCode(ticket.id, env);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code, eventId: event.id },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      ticket: { car: unknown; licensePlate: unknown };
    }>();
    expect(body.ticket.car).toBeNull();
    expect(body.ticket.licensePlate).toBeNull();
  });
});
