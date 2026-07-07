import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const validBody = {
  slug: 'encontro-sp-maio',
  title: 'Encontro SP',
  description: 'Domingo no autódromo.',
  coverObjectKey: null,
  startsAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
  endsAt: new Date(Date.now() + 7 * 86400_000 + 6 * 3600_000).toISOString(),
  venueName: 'Autódromo',
  venueAddress: 'Rua X, 100',
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'meeting',
  capacity: 200,
};

describe('POST /admin/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/events', payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it('201 creates a draft event and writes audit row', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body: { id: string; slug: string; status: string; publishedAt: unknown } = res.json();
    expect(body.slug).toBe(validBody.slug);
    expect(body.status).toBe('draft');
    expect(body.publishedAt).toBeNull();

    const row = await prisma.event.findUniqueOrThrow({ where: { slug: validBody.slug } });
    expect(row.status).toBe('draft');
    expect(row.publishedAt).toBeNull();

    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'event.create',
      entityType: 'event',
      entityId: row.id,
    });
  });

  it('400 on duplicate slug', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const auth = { authorization: bearer(loadEnv(), user.id, 'organizer') };
    await app.inject({ method: 'POST', url: '/admin/events', headers: auth, payload: validBody });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: auth,
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
  });

  it('400 on endsAt before startsAt', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { ...validBody, endsAt: validBody.startsAt },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores maxTicketsPerUser and returns it in response', async () => {
    const { user } = await createUser({ email: 'o2@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { ...validBody, slug: 'ev-max-tix', maxTicketsPerUser: 3 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ maxTicketsPerUser: number }>();
    expect(body.maxTicketsPerUser).toBe(3);
    const row = await prisma.event.findUniqueOrThrow({ where: { slug: 'ev-max-tix' } });
    expect(row.maxTicketsPerUser).toBe(3);
  });

  it('defaults maxTicketsPerUser to null (unlimited) when omitted', async () => {
    const { user } = await createUser({ email: 'o3@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { ...validBody, slug: 'ev-default-max' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ maxTicketsPerUser: number | null }>();
    expect(body.maxTicketsPerUser).toBeNull();
  });

  it('accepts maxTicketsPerUser above legacy cap of 10', async () => {
    const { user } = await createUser({ email: 'o4@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { ...validBody, slug: 'ev-many', maxTicketsPerUser: 250 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ maxTicketsPerUser: number }>();
    expect(body.maxTicketsPerUser).toBe(250);
  });

  it('accepts maxTicketsPerUser=null (explicit unlimited)', async () => {
    const { user } = await createUser({ email: 'o5@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { ...validBody, slug: 'ev-unlimited', maxTicketsPerUser: null },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ maxTicketsPerUser: number | null }>();
    expect(body.maxTicketsPerUser).toBeNull();
  });
});
