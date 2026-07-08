import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('PATCH /admin/events/:eventId/tiers/:tierId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const seed = async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'e',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
        tiers: { create: { name: 'Geral', priceCents: 5000, quantityTotal: 100, sortOrder: 0 } },
      },
      include: { tiers: true },
    });
    return { event, tier: event.tiers[0]! };
  };

  it('updates a field and writes audit', async () => {
    const { event, tier } = await seed();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { priceCents: 7500 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(row.priceCents).toBe(7500);
  });

  it('updates requiresCar to true', async () => {
    const { event, tier } = await seed();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { requiresCar: true },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(row.requiresCar).toBe(true);
  });

  it('updates requiresCar back to false', async () => {
    const { event } = await seed();
    const tierWithCar = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Piloto',
        priceCents: 10000,
        quantityTotal: 10,
        sortOrder: 1,
        requiresCar: true,
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}/tiers/${tierWithCar.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { requiresCar: false },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tierWithCar.id } });
    expect(row.requiresCar).toBe(false);
  });

  it('404 when tier belongs to a different event', async () => {
    const { tier } = await seed();
    const other = await prisma.event.create({
      data: {
        slug: 'other',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${other.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { priceCents: 7500 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('sets isPremiumGrantable to true via PATCH', async () => {
    const { event, tier } = await seed();
    const { user } = await createUser({ email: 'o4@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { isPremiumGrantable: true },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(row.isPremiumGrantable).toBe(true);
  });

  it('sets isPremiumGrantable back to false via PATCH', async () => {
    const { event } = await seed();
    const grantableTier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Gold Tier',
        priceCents: 0,
        quantityTotal: 20,
        sortOrder: 1,
        isPremiumGrantable: true,
      },
    });
    const { user } = await createUser({ email: 'o5@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}/tiers/${grantableTier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { isPremiumGrantable: false },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: grantableTier.id } });
    expect(row.isPremiumGrantable).toBe(false);
  });
});
