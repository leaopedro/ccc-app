import { prisma } from '@jdm/db';
import { myTicketSchema, myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { grantCompTicket } from '../../src/services/tickets/grant.js';
import { issueTicketForPaidOrder } from '../../src/services/tickets/issue.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEventAndTier = async (quantityTotal = 1, opts?: { maxTicketsPerUser?: number }) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: quantityTotal,
      maxTicketsPerUser: opts?.maxTicketsPerUser ?? 1,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal,
      quantitySold: 0,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

describe('Ticket nicknames', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('issueTicketForPaidOrder', () => {
    it('persists nickname from per-ticket metadata', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier(3, { maxTicketsPerUser: 3 });

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          amountCents: 5000 * 3,
          quantity: 3,
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_nick_${Math.random().toString(36).slice(2, 10)}`,
          status: 'pending',
        },
      });

      const metadata: Record<string, string> = {
        orderId: order.id,
        tickets: JSON.stringify([{ e: [], n: 'Alice' }, { e: [], n: 'Bob' }, { e: [] }]),
      };

      await issueTicketForPaidOrder(order.id, order.providerRef!, env, metadata);

      const tickets = await prisma.ticket.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(tickets).toHaveLength(3);
      expect(tickets[0]!.nickname).toBe('Alice');
      expect(tickets[1]!.nickname).toBe('Bob');
      expect(tickets[2]!.nickname).toBeNull();
    });

    it('leaves nickname null when metadata omits it', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier();

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          amountCents: 5000,
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_nonick_${Math.random().toString(36).slice(2, 10)}`,
          status: 'pending',
        },
      });

      await issueTicketForPaidOrder(order.id, order.providerRef!, env);

      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
      expect(ticket.nickname).toBeNull();
    });
  });

  describe('grantCompTicket', () => {
    it('persists nickname on comp grant', async () => {
      const { user: actor } = await createUser({
        verified: true,
        email: 'admin@jdm.test',
        role: 'admin',
      });
      const { user: holder } = await createUser({ verified: true, email: 'holder@jdm.test' });
      const { event, tier } = await seedEventAndTier();

      const result = await grantCompTicket(
        {
          actorId: actor.id,
          userId: holder.id,
          eventId: event.id,
          tierId: tier.id,
          nickname: 'Convidado VIP',
        },
        env,
      );

      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
      expect(ticket.nickname).toBe('Convidado VIP');
    });
  });

  describe('GET /me/tickets', () => {
    it('returns nickname (null when unset, string when set)', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier(2, { maxTicketsPerUser: 2 });
      await prisma.ticket.create({
        data: { userId: user.id, eventId: event.id, tierId: tier.id, source: 'purchase' },
      });
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          nickname: 'Carro do João',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/me/tickets',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = myTicketsResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);
      const nicknames = body.items.map((t) => t.nickname);
      expect(nicknames).toContain(null);
      expect(nicknames).toContain('Carro do João');
    });
  });

  describe('PATCH /me/tickets/:id', () => {
    it('updates the nickname for the caller own ticket', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier();
      const ticket = await prisma.ticket.create({
        data: { userId: user.id, eventId: event.id, tierId: tier.id, source: 'purchase' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/me/tickets/${ticket.id}`,
        headers: { authorization: bearer(env, user.id) },
        payload: { nickname: 'Acompanhante' },
      });
      expect(res.statusCode).toBe(200);
      const body = myTicketSchema.parse(res.json());
      expect(body.id).toBe(ticket.id);
      expect(body.nickname).toBe('Acompanhante');

      const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(reloaded.nickname).toBe('Acompanhante');
    });

    it('treats an empty body as a no-op (omitted nickname does not clear)', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier();
      const ticket = await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          nickname: 'preservar',
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/me/tickets/${ticket.id}`,
        headers: { authorization: bearer(env, user.id) },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = myTicketSchema.parse(res.json());
      expect(body.nickname).toBe('preservar');

      const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(reloaded.nickname).toBe('preservar');
    });

    it('clears the nickname when null is provided', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier();
      const ticket = await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          nickname: 'antigo',
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/me/tickets/${ticket.id}`,
        headers: { authorization: bearer(env, user.id) },
        payload: { nickname: null },
      });
      expect(res.statusCode).toBe(200);
      const body = myTicketSchema.parse(res.json());
      expect(body.nickname).toBeNull();

      const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(reloaded.nickname).toBeNull();
    });

    it('returns 404 when caller is not the owner', async () => {
      const { user: owner } = await createUser({ verified: true });
      const { user: other } = await createUser({ verified: true, email: 'other@jdm.test' });
      const { event, tier } = await seedEventAndTier();
      const ticket = await prisma.ticket.create({
        data: { userId: owner.id, eventId: event.id, tierId: tier.id, source: 'purchase' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/me/tickets/${ticket.id}`,
        headers: { authorization: bearer(env, other.id) },
        payload: { nickname: 'malicioso' },
      });
      expect(res.statusCode).toBe(404);

      const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(reloaded.nickname).toBeNull();
    });

    it('returns 404 for unknown ticket id', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'PATCH',
        url: '/me/tickets/missing-id',
        headers: { authorization: bearer(env, user.id) },
        payload: { nickname: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/me/tickets/anything',
        payload: { nickname: 'x' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects nickname over 60 chars', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedEventAndTier();
      const ticket = await prisma.ticket.create({
        data: { userId: user.id, eventId: event.id, tierId: tier.id, source: 'purchase' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/me/tickets/${ticket.id}`,
        headers: { authorization: bearer(env, user.id) },
        payload: { nickname: 'x'.repeat(61) },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });
  });
});
