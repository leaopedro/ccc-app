import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: 'ev-tiers',
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

describe('POST /admin/events/:eventId/tiers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a tier and writes audit', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: 5000, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(201);
    const tiers = await prisma.ticketTier.findMany({ where: { eventId: event.id } });
    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.currency).toBe('BRL');
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('tier.create');
  });

  it('404 for unknown event', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/missing/tiers',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: 5000, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on priceCents < 0', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: -1, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates tier with requiresCar=true', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Piloto', priceCents: 10000, quantityTotal: 20, requiresCar: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ requiresCar: boolean }>();
    expect(body.requiresCar).toBe(true);
    const tier = await prisma.ticketTier.findFirstOrThrow({ where: { eventId: event.id } });
    expect(tier.requiresCar).toBe(true);
  });

  it('creates tier with requiresCar=false by default', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: 5000, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ requiresCar: boolean }>();
    expect(body.requiresCar).toBe(false);
  });

  it('creates a tier with isPremiumGrantable=true', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o2@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Premium', priceCents: 0, quantityTotal: 50, isPremiumGrantable: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ isPremiumGrantable: boolean }>();
    expect(body.isPremiumGrantable).toBe(true);
    const tier = await prisma.ticketTier.findFirstOrThrow({ where: { eventId: event.id } });
    expect(tier.isPremiumGrantable).toBe(true);
  });

  it('defaults isPremiumGrantable to false when omitted', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o3@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral2', priceCents: 5000, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ isPremiumGrantable: boolean }>();
    expect(body.isPremiumGrantable).toBe(false);
  });
});
