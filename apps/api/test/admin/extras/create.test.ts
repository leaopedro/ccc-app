import { prisma } from '@jdm/db';
import { adminExtraSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: 'ev-extras',
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

describe('POST /admin/events/:eventId/extras', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates an extra and writes audit', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Camiseta', priceCents: 8000, quantityTotal: 50 },
    });
    expect(res.statusCode).toBe(201);
    const body = adminExtraSchema.parse(res.json());
    expect(body.name).toBe('Camiseta');
    expect(body.priceCents).toBe(8000);
    expect(body.currency).toBe('BRL');
    expect(body.quantityTotal).toBe(50);
    expect(body.active).toBe(true);

    const extras = await prisma.ticketExtra.findMany({ where: { eventId: event.id } });
    expect(extras).toHaveLength(1);

    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('extra.create');
  });

  it('creates an extra with null quantityTotal (unlimited)', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Estacionamento', priceCents: 2000, quantityTotal: null },
    });
    expect(res.statusCode).toBe(201);
    const body = adminExtraSchema.parse(res.json());
    expect(body.quantityTotal).toBeNull();
  });

  it('404 for unknown event', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/missing/extras',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Camiseta', priceCents: 8000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on negative priceCents', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Camiseta', priceCents: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 on negative quantityTotal', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Camiseta', priceCents: 100, quantityTotal: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 without auth', async () => {
    const event = await mkEvent();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      payload: { name: 'Camiseta', priceCents: 8000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { name: 'Camiseta', priceCents: 8000 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('auto-increments sortOrder', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const auth = { authorization: bearer(loadEnv(), user.id, 'organizer') };

    await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: auth,
      payload: { name: 'A', priceCents: 100 },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/extras`,
      headers: auth,
      payload: { name: 'B', priceCents: 200 },
    });
    const body = adminExtraSchema.parse(res.json());
    expect(body.sortOrder).toBe(1);
  });
});
