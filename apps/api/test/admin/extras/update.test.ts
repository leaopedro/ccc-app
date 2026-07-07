import { prisma } from '@jdm/db';
import { adminExtraSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkExtra = async () => {
  const event = await prisma.event.create({
    data: {
      slug: 'ev-extras-up',
      title: 't',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      type: 'meeting',
      capacity: 10,
      status: 'draft',
    },
  });
  const extra = await prisma.ticketExtra.create({
    data: {
      eventId: event.id,
      name: 'Camiseta',
      priceCents: 8000,
      quantityTotal: 50,
      active: true,
      sortOrder: 0,
    },
  });
  return { event, extra };
};

describe('PATCH /admin/extras/:extraId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('updates extra fields and writes audit', async () => {
    const { extra } = await mkExtra();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Boné', priceCents: 5000 },
    });
    expect(res.statusCode).toBe(200);
    const body = adminExtraSchema.parse(res.json());
    expect(body.name).toBe('Boné');
    expect(body.priceCents).toBe(5000);

    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('extra.update');
    expect(audits[0]!.metadata).toMatchObject({ fields: ['name', 'priceCents'] });
  });

  it('toggles active flag', async () => {
    const { extra } = await mkExtra();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);
    const body = adminExtraSchema.parse(res.json());
    expect(body.active).toBe(false);
  });

  it('sets quantityTotal to null (unlimited)', async () => {
    const { extra } = await mkExtra();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { quantityTotal: null },
    });
    expect(res.statusCode).toBe(200);
    const body = adminExtraSchema.parse(res.json());
    expect(body.quantityTotal).toBeNull();
  });

  it('404 for unknown extra', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/extras/missing',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on negative quantityTotal', async () => {
    const { extra } = await mkExtra();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { quantityTotal: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 without auth', async () => {
    const { extra } = await mkExtra();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/extras/${extra.id}`,
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { extra } = await mkExtra();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});
