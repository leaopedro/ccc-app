import { prisma } from '@jdm/db';
import type { AdminTicketRow, AdminTicketsListResponse } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: 'ev-tickets',
      title: 'Ticket Event',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      capacity: 100,
      status: 'published',
    },
  });

const mkTier = (eventId: string, name = 'Geral') =>
  prisma.ticketTier.create({
    data: { eventId, name, priceCents: 5000, currency: 'BRL', quantityTotal: 50 },
  });

const mkTicket = (
  userId: string,
  eventId: string,
  tierId: string,
  overrides: Partial<{
    source: 'purchase' | 'premium_grant' | 'comp';
    status: 'valid' | 'used' | 'revoked';
    usedAt: Date;
  }> = {},
) =>
  prisma.ticket.create({
    data: {
      userId,
      eventId,
      tierId,
      source: overrides.source ?? 'purchase',
      status: overrides.status ?? 'valid',
      usedAt: overrides.usedAt ?? null,
    },
  });

const json = (res: { json: () => unknown }) => res.json() as AdminTicketsListResponse;

describe('GET /admin/events/:id/tickets', () => {
  let app: FastifyInstance;
  const env = () => loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/events/any/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@test.com', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events/any/tickets',
      headers: { authorization: bearer(env(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 for staff role', async () => {
    const { user } = await createUser({ email: 's@test.com', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events/any/tickets',
      headers: { authorization: bearer(env(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 for unknown event', async () => {
    const { user } = await createUser({ email: 'o@test.com', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events/nonexistent/tickets',
      headers: { authorization: bearer(env(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns empty list when no tickets', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@test.com', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets`,
      headers: { authorization: bearer(env(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('returns ticket with holder, tier, code, extras shape', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: holder } = await createUser({
      email: 'h@test.com',
      name: 'Holder',
      verified: true,
    });
    const { user: admin } = await createUser({
      email: 'a@test.com',
      verified: true,
      role: 'admin',
    });
    const ticket = await mkTicket(holder.id, event.id, tier.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets`,
      headers: { authorization: bearer(env(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toHaveLength(1);
    const row = body.items[0] as AdminTicketRow;
    expect(row.id).toBe(ticket.id);
    expect(row.holder).toMatchObject({ id: holder.id, name: 'Holder', email: 'h@test.com' });
    expect(row.holder.avatarUrl).toBeNull();
    expect(row.tier).toMatchObject({ id: tier.id, name: 'Geral' });
    expect(row.extras).toEqual([]);
    expect(row.status).toBe('valid');
    expect(row.source).toBe('purchase');
    expect(row.code).toContain('.');
    expect(row.usedAt).toBeNull();
    expect(row.car).toBeNull();
    expect(row.licensePlate).toBeNull();
  });

  it('filters by status', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: h1 } = await createUser({ email: 'h1@test.com', verified: true });
    const { user: h2 } = await createUser({ email: 'h2@test.com', verified: true });
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    await mkTicket(h1.id, event.id, tier.id, { status: 'valid' });
    await mkTicket(h2.id, event.id, tier.id, { status: 'used', usedAt: new Date() });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?status=used`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe('used');
  });

  it('filters by source', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: h1 } = await createUser({ email: 'h1@test.com', verified: true });
    const { user: h2 } = await createUser({ email: 'h2@test.com', verified: true });
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    await mkTicket(h1.id, event.id, tier.id, { source: 'purchase' });
    await mkTicket(h2.id, event.id, tier.id, { source: 'comp' });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?source=comp`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.source).toBe('comp');
  });

  it('filters by tier', async () => {
    const event = await mkEvent();
    const tierA = await mkTier(event.id, 'VIP');
    const tierB = await mkTier(event.id, 'Geral');
    const { user: h1 } = await createUser({ email: 'h1@test.com', verified: true });
    const { user: h2 } = await createUser({ email: 'h2@test.com', verified: true });
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    await mkTicket(h1.id, event.id, tierA.id);
    await mkTicket(h2.id, event.id, tierB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?tier=${tierA.id}`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.tier.name).toBe('VIP');
  });

  it('searches by holder name (q param)', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: alice } = await createUser({
      email: 'alice@test.com',
      name: 'Alice Santos',
      verified: true,
    });
    const { user: bob } = await createUser({
      email: 'bob@test.com',
      name: 'Bob Silva',
      verified: true,
    });
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    await mkTicket(alice.id, event.id, tier.id);
    await mkTicket(bob.id, event.id, tier.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?q=alice`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.holder.name).toBe('Alice Santos');
  });

  it('searches by holder email (q param)', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: alice } = await createUser({
      email: 'alice@test.com',
      name: 'Alice',
      verified: true,
    });
    const { user: bob } = await createUser({
      email: 'bob@test.com',
      name: 'Bob',
      verified: true,
    });
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    await mkTicket(alice.id, event.id, tier.id);
    await mkTicket(bob.id, event.id, tier.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?q=bob%40test`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.holder.email).toBe('bob@test.com');
  });

  it('cursor paginates correctly', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });

    const holders = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createUser({ email: `h${i}@test.com`, name: `H${i}`, verified: true }),
      ),
    );
    for (const { user: h } of holders) {
      await mkTicket(h.id, event.id, tier.id);
    }

    const res1 = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?limit=3`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = json(res1);
    expect(body1.items).toHaveLength(3);
    expect(body1.nextCursor).toBeTruthy();

    const res2 = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?limit=3&cursor=${body1.nextCursor}`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = json(res2);
    expect(body2.items).toHaveLength(2);
    expect(body2.nextCursor).toBeNull();

    const allIds = [...body1.items.map((i) => i.id), ...body2.items.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(5);
  });

  it('extra filter accepted but returns all (no-op until C1)', async () => {
    const event = await mkEvent();
    const tier = await mkTier(event.id);
    const { user: h } = await createUser({ email: 'h@test.com', verified: true });
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    await mkTicket(h.id, event.id, tier.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?extra=some-extra-id`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res).items).toHaveLength(1);
  });

  it('400 on invalid cursor', async () => {
    const event = await mkEvent();
    const { user: org } = await createUser({
      email: 'o@test.com',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/tickets?cursor=bad!!!`,
      headers: { authorization: bearer(env(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(400);
  });
});
