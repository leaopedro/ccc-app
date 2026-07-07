import { prisma } from '@jdm/db';
import { confirmedCarsResponseSchema } from '@jdm/shared/events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

const makeEventWithCarTier = async (slug: string) =>
  prisma.event.create({
    data: {
      slug,
      title: 'Evento Carros',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'Local',
      venueAddress: 'Rua A, 1',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 100,
      publishedAt: new Date(),
      tiers: {
        create: [
          { name: 'Geral', priceCents: 5000, quantityTotal: 100, sortOrder: 0 },
          {
            name: 'Car Pass',
            priceCents: 10000,
            quantityTotal: 50,
            sortOrder: 1,
            requiresCar: true,
          },
        ],
      },
    },
    include: { tiers: true },
  });

const makeEventNoCarTier = async (slug: string) =>
  prisma.event.create({
    data: {
      slug,
      title: 'Evento Sem Carro',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'Local',
      venueAddress: 'Rua B, 2',
      city: 'Rio de Janeiro',
      stateCode: 'RJ',
      type: 'meeting',
      status: 'published',
      capacity: 100,
      publishedAt: new Date(),
      tiers: {
        create: [{ name: 'Geral', priceCents: 3000, quantityTotal: 100, sortOrder: 0 }],
      },
    },
    include: { tiers: true },
  });

const seedCar = async (userId: string, opts?: { withPhoto?: boolean; nickname?: string }) => {
  const car = await prisma.car.create({
    data: {
      userId,
      make: 'Toyota',
      model: 'Supra',
      year: 1994,
      nickname: opts?.nickname ?? 'Supra',
    },
  });
  if (opts?.withPhoto) {
    await prisma.carPhoto.create({
      data: { carId: car.id, objectKey: `cars/${car.id}/photo.jpg`, sortOrder: 0 },
    });
  }
  return car;
};

const seedTicket = async (
  userId: string,
  eventId: string,
  tierId: string,
  carId: string,
  status: 'valid' | 'revoked' = 'valid',
) =>
  prisma.ticket.create({
    data: { userId, eventId, tierId, carId, status, source: 'purchase' },
  });

describe('GET /events/:slug/confirmed-cars', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/events/nope/confirmed-cars' });
    expect(res.statusCode).toBe(404);
  });

  it('returns empty list when no car-required tiers', async () => {
    await makeEventNoCarTier('no-car-tiers');
    const res = await app.inject({ method: 'GET', url: '/events/no-car-tiers/confirmed-cars' });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('returns empty list when event has car tier but no valid tickets with cars', async () => {
    await makeEventWithCarTier('car-tier-no-tickets');
    const res = await app.inject({
      method: 'GET',
      url: '/events/car-tier-no-tickets/confirmed-cars',
    });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
  });

  it('returns public car fields for valid tickets on car-required tiers', async () => {
    const { user } = await createUser({ verified: true });
    const event = await makeEventWithCarTier('has-confirmed-cars');
    const carTier = event.tiers.find((t) => t.requiresCar)!;
    const car = await seedCar(user.id);
    await seedTicket(user.id, event.id, carTier.id, car.id);

    const res = await app.inject({
      method: 'GET',
      url: '/events/has-confirmed-cars/confirmed-cars',
    });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    const c = body.items[0]!;
    // ref is an opaque hash — just verify it's a non-empty string, not the raw car.id
    expect(typeof c.ref).toBe('string');
    expect(c.ref.length).toBeGreaterThan(0);
    expect(c.ref).not.toBe(car.id);
    expect(c.make).toBe('Toyota');
    expect(c.model).toBe('Supra');
    expect(c.year).toBe(1994);
    expect(c.photoUrl).toBeNull();
    // id and nickname must not be in response
    expect((c as Record<string, unknown>)['id']).toBeUndefined();
    expect((c as Record<string, unknown>)['nickname']).toBeUndefined();
  });

  it('includes photoUrl when car has a photo', async () => {
    const { user } = await createUser({ verified: true });
    const event = await makeEventWithCarTier('car-with-photo');
    const carTier = event.tiers.find((t) => t.requiresCar)!;
    const car = await seedCar(user.id, { withPhoto: true });
    await seedTicket(user.id, event.id, carTier.id, car.id);

    const res = await app.inject({ method: 'GET', url: '/events/car-with-photo/confirmed-cars' });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items[0]?.photoUrl).not.toBeNull();
  });

  it('privacy: response never contains plate, licensePlate, or userId', async () => {
    const { user } = await createUser({ verified: true });
    const event = await makeEventWithCarTier('privacy-check');
    const carTier = event.tiers.find((t) => t.requiresCar)!;
    const car = await seedCar(user.id);
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: carTier.id,
        carId: car.id,
        licensePlate: 'ABC-1234',
        status: 'valid',
        source: 'purchase',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/events/privacy-check/confirmed-cars' });
    expect(res.statusCode).toBe(200);
    const raw = res.body;
    expect(raw).not.toContain('ABC-1234');
    expect(raw).not.toContain('licensePlate');
    expect(raw).not.toContain('plate');
    expect(raw).not.toContain(user.id);

    // Parse through schema to ensure shape is restricted
    const body = confirmedCarsResponseSchema.parse(res.json());
    const c = body.items[0] as Record<string, unknown> | undefined;
    expect(c).toBeDefined();
    expect(c!['id']).toBeUndefined();
    expect(c!['nickname']).toBeUndefined();
    expect(c!['licensePlate']).toBeUndefined();
    expect(c!['plate']).toBeUndefined();
    expect(c!['userId']).toBeUndefined();
  });

  it('excludes revoked tickets', async () => {
    const { user } = await createUser({ verified: true });
    const event = await makeEventWithCarTier('cancelled-ticket');
    const carTier = event.tiers.find((t) => t.requiresCar)!;
    const car = await seedCar(user.id);
    await seedTicket(user.id, event.id, carTier.id, car.id, 'revoked');

    const res = await app.inject({ method: 'GET', url: '/events/cancelled-ticket/confirmed-cars' });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
  });

  it('excludes tickets on non-car tiers', async () => {
    const { user } = await createUser({ verified: true });
    const event = await makeEventWithCarTier('non-car-tier-ticket');
    const generalTier = event.tiers.find((t) => !t.requiresCar)!;
    const car = await seedCar(user.id);
    // Ticket on general (non-car) tier — should not appear
    await seedTicket(user.id, event.id, generalTier.id, car.id);

    const res = await app.inject({
      method: 'GET',
      url: '/events/non-car-tier-ticket/confirmed-cars',
    });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
  });

  it('deduplicates when same car has multiple valid tickets', async () => {
    const { user } = await createUser({ verified: true });
    const event = await makeEventWithCarTier('dedup-cars');
    const carTier = event.tiers.find((t) => t.requiresCar)!;
    const car = await seedCar(user.id);
    // Two tickets referencing same car
    await prisma.ticket.createMany({
      data: [
        {
          userId: user.id,
          eventId: event.id,
          tierId: carTier.id,
          carId: car.id,
          status: 'valid',
          source: 'purchase',
        },
        {
          userId: user.id,
          eventId: event.id,
          tierId: carTier.id,
          carId: car.id,
          status: 'valid',
          source: 'purchase',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/events/dedup-cars/confirmed-cars' });
    expect(res.statusCode).toBe(200);
    const body = confirmedCarsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('accessible without authentication', async () => {
    await makeEventWithCarTier('anon-access');
    const res = await app.inject({
      method: 'GET',
      url: '/events/anon-access/confirmed-cars',
      // no Authorization header
    });
    expect(res.statusCode).toBe(200);
  });
});
