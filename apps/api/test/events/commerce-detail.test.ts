import { prisma } from '@jdm/db';
import { eventDetailCommerceSchema } from '@jdm/shared/events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const makePublishedEvent = (slug: string) =>
  prisma.event.create({
    data: {
      slug,
      title: 'Test Event',
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
        create: [{ name: 'Geral', priceCents: 5000, quantityTotal: 100, sortOrder: 0 }],
      },
    },
  });

describe('GET /events/:slug/commerce (auth required)', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    const { user } = await createUser({ verified: true });
    authHeader = bearer(env, user.id);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without auth', async () => {
    await makePublishedEvent('auth-required');
    const res = await app.inject({ method: 'GET', url: '/events/auth-required/commerce' });
    expect(res.statusCode).toBe(401);
  });

  it('returns commerce detail with tiers and remaining capacity', async () => {
    await prisma.event.create({
      data: {
        slug: 'commerce-tiers',
        title: 'Commerce',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
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

    const res = await app.inject({
      method: 'GET',
      url: '/events/commerce-tiers/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.tiers).toHaveLength(2);
    const general = body.tiers.find((t) => t.name === 'Geral');
    expect(general?.remainingCapacity).toBe(90);
    const vip = body.tiers.find((t) => t.name === 'VIP');
    expect(vip?.remainingCapacity).toBe(20);
  });

  it('returns tiers sorted by sortOrder', async () => {
    await prisma.event.create({
      data: {
        slug: 'sorted-commerce',
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
        capacity: 10,
        publishedAt: new Date(),
        tiers: {
          create: [
            { name: 'B', priceCents: 100, quantityTotal: 5, sortOrder: 1 },
            { name: 'A', priceCents: 200, quantityTotal: 5, sortOrder: 0 },
          ],
        },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/events/sorted-commerce/commerce',
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.tiers.map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('exposes requiresCar on tiers', async () => {
    await prisma.event.create({
      data: {
        slug: 'pilots-only-commerce',
        title: 'Drift Event',
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
    const res = await app.inject({
      method: 'GET',
      url: '/events/pilots-only-commerce/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.tiers.find((t) => t.name === 'Espectador')?.requiresCar).toBe(false);
    expect(body.tiers.find((t) => t.name === 'Piloto')?.requiresCar).toBe(true);
  });

  it('returns hasCarTier=false when no tier requires a car', async () => {
    await makePublishedEvent('commerce-no-car-tier');
    const res = await app.inject({
      method: 'GET',
      url: '/events/commerce-no-car-tier/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.hasCarTier).toBe(false);
  });

  it('returns hasCarTier=true when at least one tier requires a car', async () => {
    await prisma.event.create({
      data: {
        slug: 'commerce-has-car-tier',
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
    const res = await app.inject({
      method: 'GET',
      url: '/events/commerce-has-car-tier/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.hasCarTier).toBe(true);
  });

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events/does-not-exist/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for draft events', async () => {
    await prisma.event.create({
      data: {
        slug: 'draft-commerce',
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
    const res = await app.inject({
      method: 'GET',
      url: '/events/draft-commerce/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(404);
  });

  it('includes active extras with computed quantityRemaining', async () => {
    const event = await makePublishedEvent('extras-test');
    await prisma.ticketExtra.create({
      data: {
        eventId: event.id,
        name: 'Camiseta Evento',
        description: 'Camiseta exclusiva',
        priceCents: 4000,
        quantityTotal: 50,
        quantitySold: 12,
        sortOrder: 0,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}/commerce`,
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras).toHaveLength(1);
    expect(body.extras[0]).toMatchObject({
      name: 'Camiseta Evento',
      description: 'Camiseta exclusiva',
      priceCents: 4000,
      currency: 'BRL',
      quantityRemaining: 38,
      sortOrder: 0,
    });
  });

  it('hides inactive extras', async () => {
    const event = await makePublishedEvent('inactive-extras');
    await prisma.ticketExtra.createMany({
      data: [
        {
          eventId: event.id,
          name: 'Active Extra',
          priceCents: 1000,
          quantityTotal: 10,
          active: true,
          sortOrder: 0,
        },
        {
          eventId: event.id,
          name: 'Inactive Extra',
          priceCents: 2000,
          quantityTotal: 10,
          active: false,
          sortOrder: 1,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}/commerce`,
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras).toHaveLength(1);
    expect(body.extras[0]!.name).toBe('Active Extra');
  });

  it('hides sold-out extras when quantityTotal is set', async () => {
    const event = await makePublishedEvent('soldout-extras');
    await prisma.ticketExtra.createMany({
      data: [
        {
          eventId: event.id,
          name: 'Available',
          priceCents: 1000,
          quantityTotal: 10,
          quantitySold: 5,
          sortOrder: 0,
        },
        {
          eventId: event.id,
          name: 'Sold Out',
          priceCents: 2000,
          quantityTotal: 10,
          quantitySold: 10,
          sortOrder: 1,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}/commerce`,
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras).toHaveLength(1);
    expect(body.extras[0]!.name).toBe('Available');
  });

  it('returns quantityRemaining=null when quantityTotal is null (unlimited)', async () => {
    const event = await makePublishedEvent('unlimited-extras');
    await prisma.ticketExtra.create({
      data: {
        eventId: event.id,
        name: 'Unlimited Extra',
        priceCents: 500,
        quantityTotal: null,
        quantitySold: 99,
        sortOrder: 0,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}/commerce`,
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras).toHaveLength(1);
    expect(body.extras[0]!.quantityRemaining).toBeNull();
  });

  it('returns extras sorted by sortOrder', async () => {
    const event = await makePublishedEvent('sorted-extras');
    await prisma.ticketExtra.createMany({
      data: [
        { eventId: event.id, name: 'C', priceCents: 100, quantityTotal: 5, sortOrder: 2 },
        { eventId: event.id, name: 'A', priceCents: 200, quantityTotal: 5, sortOrder: 0 },
        { eventId: event.id, name: 'B', priceCents: 300, quantityTotal: 5, sortOrder: 1 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}/commerce`,
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras.map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('excludes oversold extras', async () => {
    const event = await makePublishedEvent('oversold-extras');
    await prisma.ticketExtra.create({
      data: {
        eventId: event.id,
        name: 'Oversold',
        priceCents: 1000,
        quantityTotal: 10,
        quantitySold: 15,
        sortOrder: 0,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}/commerce`,
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras).toHaveLength(0);
  });

  it('returns empty extras array when event has no extras', async () => {
    await makePublishedEvent('no-extras');

    const res = await app.inject({
      method: 'GET',
      url: '/events/no-extras/commerce',
      headers: { authorization: authHeader },
    });
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.extras).toEqual([]);
  });
});

describe('GET /events/by-id/:id/commerce (auth required)', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    const { user } = await createUser({ verified: true });
    authHeader = bearer(env, user.id);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const event = await makePublishedEvent('by-id-auth');
    const res = await app.inject({ method: 'GET', url: `/events/by-id/${event.id}/commerce` });
    expect(res.statusCode).toBe(401);
  });

  it('returns commerce detail with tiers and extras when authenticated', async () => {
    const event = await makePublishedEvent('by-id-commerce');
    await prisma.ticketExtra.create({
      data: {
        eventId: event.id,
        name: 'Camiseta',
        priceCents: 4000,
        quantityTotal: 10,
        quantitySold: 0,
        sortOrder: 0,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/by-id/${event.id}/commerce`,
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(200);
    const body = eventDetailCommerceSchema.parse(res.json());
    expect(body.id).toBe(event.id);
    expect(body.tiers).toHaveLength(1);
    expect(body.extras).toHaveLength(1);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events/by-id/00000000-0000-0000-0000-000000000000/commerce',
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(404);
  });
});
