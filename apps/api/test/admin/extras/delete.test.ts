import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkExtra = async () => {
  const event = await prisma.event.create({
    data: {
      slug: 'ev-extras-del',
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

describe('DELETE /admin/extras/:extraId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes extra and writes audit', async () => {
    const { event, extra } = await mkExtra();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(204);

    const remaining = await prisma.ticketExtra.findMany({ where: { eventId: event.id } });
    expect(remaining).toHaveLength(0);

    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('extra.delete');
    expect(audits[0]!.metadata).toMatchObject({ eventId: event.id });
  });

  it('404 for unknown extra', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/extras/missing',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401 without auth', async () => {
    const { extra } = await mkExtra();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/extras/${extra.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { extra } = await mkExtra();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/extras/${extra.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });
});
