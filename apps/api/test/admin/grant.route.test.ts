import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedGrantFixture = async (opts?: { maxTicketsPerUser?: number | null }) => {
  const { user: holder } = await createUser({
    email: `h-${Math.random()}@jdm.test`,
    verified: true,
  });
  const event = await prisma.event.create({
    data: {
      slug: `ev-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Grant Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'SP',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 10,
      maxTicketsPerUser: opts?.maxTicketsPerUser ?? null,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'VIP Comp',
      priceCents: 0,
      quantityTotal: 10,
      quantitySold: 0,
      sortOrder: 0,
    },
  });
  const extra = await prisma.ticketExtra.create({
    data: {
      eventId: event.id,
      name: 'Kit',
      priceCents: 0,
      currency: 'BRL',
      quantityTotal: 50,
      quantitySold: 0,
      sortOrder: 0,
    },
  });
  return { holder, event, tier, extra };
};

describe('POST /admin/tickets/grant', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('401 without auth', async () => {
    const { holder, event, tier } = await seedGrantFixture();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for staff role', async () => {
    const { holder, event, tier } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: 'staff@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each(['organizer', 'admin'] as const)('201 comp grant for %s role', async (role) => {
    const { holder, event, tier } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: `a-${role}@jdm.test`,
      verified: true,
      role,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, role) },
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ ticketId: string; code: string; extraItems: unknown[] }>();
    expect(typeof body.ticketId).toBe('string');
    expect(body.code).toContain('.');
    expect(body.extraItems).toHaveLength(0);
  });

  it('creates Order with amountCents=0, status=paid, method=card, provider=stripe', async () => {
    const { holder, event, tier } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: 'a@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id },
    });
    expect(res.statusCode).toBe(201);
    const { ticketId } = res.json<{ ticketId: string }>();
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { order: true },
    });
    expect(ticket.source).toBe('comp');
    expect(ticket.status).toBe('valid');
    expect(ticket.order).not.toBeNull();
    expect(ticket.order!.amountCents).toBe(0);
    expect(ticket.order!.status).toBe('paid');
    expect(ticket.order!.method).toBe('card');
    expect(ticket.order!.provider).toBe('stripe');
    expect(ticket.order!.paidAt).not.toBeNull();
  });

  it('creates TicketExtraItem rows with signed codes when extras supplied', async () => {
    const { holder, event, tier, extra } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: 'b@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id, extras: [extra.id] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ ticketId: string; extraItems: { extraId: string; code: string }[] }>();
    expect(body.extraItems).toHaveLength(1);
    expect(body.extraItems[0]!.extraId).toBe(extra.id);
    expect(body.extraItems[0]!.code).toMatch(/^e\./);
    const items = await prisma.ticketExtraItem.findMany({ where: { ticketId: body.ticketId } });
    expect(items).toHaveLength(1);
    expect(items[0]!.extraId).toBe(extra.id);
  });

  it('writes ticket.grant_comp audit row with userId and note', async () => {
    const { holder, event, tier } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: 'c@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id, note: 'VIP guest' },
    });
    expect(res.statusCode).toBe(201);
    const { ticketId } = res.json<{ ticketId: string }>();
    const rows = await prisma.adminAudit.findMany({ where: { action: 'ticket.grant_comp' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(actor.id);
    expect(rows[0]!.entityType).toBe('ticket');
    expect(rows[0]!.entityId).toBe(ticketId);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta['note']).toBe('VIP guest');
    expect(meta['userId']).toBe(holder.id);
    expect(meta['eventId']).toBe(event.id);
  });

  it('increments quantitySold after comp grant', async () => {
    const { holder, event, tier } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: 'e@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: { userId: holder.id, eventId: event.id, tierId: tier.id },
    });
    expect(res.statusCode).toBe(201);
    const updated = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(updated.quantitySold).toBe(1);
  });

  it('422 when tierId does not belong to eventId', async () => {
    const { holder, event } = await seedGrantFixture();
    // Create a tier belonging to a different event
    const otherEvent = await prisma.event.create({
      data: {
        slug: `oe-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Other Event',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        publishedAt: new Date(),
        capacity: 5,
      },
    });
    const otherTier = await prisma.ticketTier.create({
      data: {
        eventId: otherEvent.id,
        name: 'Other Tier',
        priceCents: 0,
        quantityTotal: 5,
        quantitySold: 0,
        sortOrder: 0,
      },
    });
    const { user: actor } = await createUser({
      email: 'f@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: { userId: holder.id, eventId: event.id, tierId: otherTier.id },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toBe('InvalidInput');
  });

  it('422 when userId does not exist', async () => {
    const { event, tier } = await seedGrantFixture();
    const { user: actor } = await createUser({
      email: 'g@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: { userId: 'nonexistent-user-id', eventId: event.id, tierId: tier.id },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toBe('InvalidInput');
  });

  it('persists carId and licensePlate on ticket when provided', async () => {
    const { holder, event, tier } = await seedGrantFixture();
    const car = await prisma.car.create({
      data: {
        userId: holder.id,
        make: 'Toyota',
        model: 'Supra',
        year: 1994,
        nickname: 'Supra',
      },
    });
    // Make tier require car
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { requiresCar: true },
    });
    const { user: actor } = await createUser({
      email: 'car-grant@jdm.test',
      verified: true,
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: { authorization: bearer(env, actor.id, 'admin') },
      payload: {
        userId: holder.id,
        eventId: event.id,
        tierId: tier.id,
        carId: car.id,
        licensePlate: 'ABC-1234',
      },
    });
    expect(res.statusCode).toBe(201);
    const { ticketId } = res.json<{ ticketId: string }>();
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.carId).toBe(car.id);
    expect(ticket.licensePlate).toBe('ABC-1234');
  });

  it('allows repeated grants while the user remains under event.maxTicketsPerUser', async () => {
    const { holder, event, tier } = await seedGrantFixture({ maxTicketsPerUser: 2 });
    const { user: actor } = await createUser({
      email: 'd@jdm.test',
      verified: true,
      role: 'admin',
    });
    const auth = { authorization: bearer(env, actor.id, 'admin') };
    const payload = { userId: holder.id, eventId: event.id, tierId: tier.id };
    const first = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: auth,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: auth,
      payload,
    });
    expect(second.statusCode).toBe(201);
    const validTickets = await prisma.ticket.findMany({
      where: { userId: holder.id, eventId: event.id, status: 'valid' },
    });
    expect(validTickets).toHaveLength(2);
  });

  it('409 when comp grant would exceed event.maxTicketsPerUser', async () => {
    const { holder, event, tier } = await seedGrantFixture({ maxTicketsPerUser: 1 });
    const { user: actor } = await createUser({
      email: 'd-cap@jdm.test',
      verified: true,
      role: 'admin',
    });
    const auth = { authorization: bearer(env, actor.id, 'admin') };
    const payload = { userId: holder.id, eventId: event.id, tierId: tier.id };

    const first = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: auth,
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/admin/tickets/grant',
      headers: auth,
      payload,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: string }>().error).toBe('DuplicateTicket');
  });

  it('serializes concurrent grant requests for same user/event', async () => {
    const { holder, event, tier } = await seedGrantFixture({ maxTicketsPerUser: 1 });
    const { user: actor } = await createUser({
      email: 'race@jdm.test',
      verified: true,
      role: 'admin',
    });
    const auth = { authorization: bearer(env, actor.id, 'admin') };
    const payload = { userId: holder.id, eventId: event.id, tierId: tier.id };

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/admin/tickets/grant',
        headers: auth,
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/admin/tickets/grant',
        headers: auth,
        payload,
      }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    expect(codes).toEqual([201, 409]);

    const validTickets = await prisma.ticket.findMany({
      where: { userId: holder.id, eventId: event.id, status: 'valid' },
    });
    expect(validTickets).toHaveLength(1);

    const paidOrders = await prisma.order.findMany({
      where: {
        userId: holder.id,
        eventId: event.id,
        status: 'paid',
        amountCents: 0,
      },
    });
    expect(paidOrders).toHaveLength(1);

    const updatedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(updatedTier.quantitySold).toBe(1);
  });
});
