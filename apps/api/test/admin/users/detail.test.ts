import { prisma } from '@jdm/db';
import { adminUserDetailSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: `evt-${Date.now()}`,
      title: 'Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 7 * 86400_000),
      endsAt: new Date(Date.now() + 7 * 86400_000 + 3600_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'Curitiba',
      stateCode: 'PR',
      type: 'meeting',
      capacity: 100,
      status: 'published',
      publishedAt: new Date(),
    },
  });

const mkTier = (eventId: string) =>
  prisma.ticketTier.create({
    data: {
      eventId,
      name: 'Standard',
      priceCents: 5000,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      sortOrder: 0,
    },
  });

describe('GET /admin/users/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users/nonexistent' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 for nonexistent user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/nonexistent',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns user profile with zero stats', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'alice@jdm.test',
      name: 'Alice',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.id).toBe(target.id);
    expect(body.email).toBe('alice@jdm.test');
    expect(body.name).toBe('Alice');
    expect(body.stats.totalTickets).toBe(0);
    expect(body.stats.totalOrders).toBe(0);
    expect(body.recentTickets).toEqual([]);
    expect(body.recentOrders).toEqual([]);
  });

  it('includes empty groups array when user has no memberships', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'alice@jdm.test',
      name: 'Alice',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.groups).toEqual([]);
  });

  it('includes group memberships in response', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'alice@jdm.test',
      name: 'Alice',
      verified: true,
    });

    const group = await prisma.userGroup.create({
      data: { name: 'VIP', description: null },
    });
    await prisma.userGroupMembership.create({
      data: { groupId: group.id, userId: target.id },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.id).toBe(group.id);
    expect(body.groups[0]!.name).toBe('VIP');
  });

  it('includes ticket and order counts and recent items', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'buyer@jdm.test',
      name: 'Buyer',
      verified: true,
    });

    const event = await mkEvent();
    const tier = await mkTier(event.id);

    await prisma.order.create({
      data: {
        userId: target.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
      },
    });

    await prisma.ticket.create({
      data: {
        userId: target.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserDetailSchema.parse(res.json());
    expect(body.stats.totalTickets).toBe(1);
    expect(body.stats.totalOrders).toBe(1);
    expect(body.recentTickets.length).toBe(1);
    expect(body.recentTickets[0]!.eventTitle).toBe('Test Event');
    expect(body.recentTickets[0]!.status).toBe('valid');
    expect(body.recentOrders.length).toBe(1);
    expect(body.recentOrders[0]!.amountCents).toBe(5000);
    expect(body.recentOrders[0]!.status).toBe('paid');
  });
});
