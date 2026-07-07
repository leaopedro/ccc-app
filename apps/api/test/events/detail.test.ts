import { prisma } from '@jdm/db';
import { eventDetailPublicSchema } from '@jdm/shared/events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

describe('GET /events/:slug (public)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the public detail without tiers or extras', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'encontro-sp',
        title: 'Encontro SP',
        description: 'Um belo encontro',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'Autódromo',
        venueAddress: 'Rua X, 100',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 200,
        publishedAt: new Date(),
        tiers: {
          create: [
            { name: 'Geral', priceCents: 5000, quantityTotal: 100, quantitySold: 10, sortOrder: 0 },
            { name: 'VIP', priceCents: 15000, quantityTotal: 20, quantitySold: 0, sortOrder: 1 },
          ],
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: `/events/${event.slug}` });
    expect(res.statusCode).toBe(200);
    const json: Record<string, unknown> = res.json();
    expect(json).not.toHaveProperty('tiers');
    expect(json).not.toHaveProperty('extras');
    const body = eventDetailPublicSchema.parse(json);
    expect(body.slug).toBe('encontro-sp');
    expect(body.description).toBe('Um belo encontro');
    expect(body.capacity).toBe(200);
  });

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/events/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for draft event (draft not publicly visible)', async () => {
    await prisma.event.create({
      data: {
        slug: 'draft-one',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        status: 'draft',
        capacity: 10,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/events/draft-one' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for cancelled event', async () => {
    await prisma.event.create({
      data: {
        slug: 'cancelled-one',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        status: 'cancelled',
        capacity: 10,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/events/cancelled-one' });
    expect(res.statusCode).toBe(404);
  });

  it('returns hasCarTier=false when no tier requires a car', async () => {
    await prisma.event.create({
      data: {
        slug: 'no-car-tier',
        title: 't',
        description: 'd',
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
        tiers: {
          create: [
            {
              name: 'Geral',
              priceCents: 5000,
              quantityTotal: 50,
              sortOrder: 0,
              requiresCar: false,
            },
          ],
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/events/no-car-tier' });
    expect(res.statusCode).toBe(200);
    const body = eventDetailPublicSchema.parse(res.json());
    expect(body.hasCarTier).toBe(false);
  });

  it('returns hasCarTier=true when at least one tier requires a car', async () => {
    await prisma.event.create({
      data: {
        slug: 'has-car-tier',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'drift',
        status: 'published',
        capacity: 50,
        publishedAt: new Date(),
        tiers: {
          create: [
            {
              name: 'Espectador',
              priceCents: 2000,
              quantityTotal: 40,
              sortOrder: 0,
              requiresCar: false,
            },
            {
              name: 'Piloto',
              priceCents: 8000,
              quantityTotal: 10,
              sortOrder: 1,
              requiresCar: true,
            },
          ],
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/events/has-car-tier' });
    expect(res.statusCode).toBe(200);
    const body = eventDetailPublicSchema.parse(res.json());
    expect(body.hasCarTier).toBe(true);
  });
});

describe('GET /events/by-id/:id (public)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the public detail without tiers or extras', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'by-id-public',
        title: 'By ID',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 50,
        publishedAt: new Date(),
        tiers: {
          create: [{ name: 'Geral', priceCents: 1000, quantityTotal: 10, sortOrder: 0 }],
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: `/events/by-id/${event.id}` });
    expect(res.statusCode).toBe(200);
    const json: Record<string, unknown> = res.json();
    expect(json).not.toHaveProperty('tiers');
    expect(json).not.toHaveProperty('extras');
    const body = eventDetailPublicSchema.parse(json);
    expect(body.id).toBe(event.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events/by-id/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});
