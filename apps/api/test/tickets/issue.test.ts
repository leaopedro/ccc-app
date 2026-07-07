import { prisma } from '@jdm/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { verifyQrCode } from '../../src/lib/qr.js';
import { verifyTicketCode } from '../../src/services/tickets/codes.js';
import {
  OrderNotPendingError,
  TicketAlreadyExistsForEventError,
  issueTicketForPaidOrder,
} from '../../src/services/tickets/issue.js';
import { createUser, resetDatabase } from '../helpers.js';

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
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

const createPendingOrder = async (userId: string, eventId: string, tierId: string) => {
  return prisma.order.create({
    data: {
      userId,
      eventId,
      tierId,
      amountCents: 5000,
      method: 'card',
      provider: 'stripe',
      providerRef: `pi_test_${Math.random().toString(36).slice(2, 10)}`,
      status: 'pending',
    },
  });
};

describe('issueTicketForPaidOrder', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('marks order paid and issues a ticket with a valid signed code', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const result = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
    expect(result.ticketId).toBeTruthy();

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');
    expect(reloaded.paidAt).not.toBeNull();

    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(ticket.status).toBe('valid');
    expect(ticket.source).toBe('purchase');
    expect(ticket.userId).toBe(user.id);
    expect(ticket.eventId).toBe(event.id);

    const code = result.code;
    expect(verifyTicketCode(code, env)).toBe(ticket.id);
  });

  it('is idempotent - calling twice returns the same ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const a = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
    const b = await issueTicketForPaidOrder(order.id, order.providerRef!, env);

    expect(a.ticketId).toBe(b.ticketId);
    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(1);
  });

  it('throws if order is already failed (webhook ordering bug)', async () => {
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
        providerRef: 'pi_test_failed',
        status: 'failed',
        failedAt: new Date(),
      },
    });
    await expect(issueTicketForPaidOrder(order.id, 'pi_test_failed', env)).rejects.toThrow(
      OrderNotPendingError,
    );
  });

  it('throws if user already has a ticket for this event (premium-grant race, future F8)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier(2);
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'comp',
        status: 'valid',
      },
    });
    const order = await createPendingOrder(user.id, event.id, tier.id);

    await expect(issueTicketForPaidOrder(order.id, order.providerRef!, env)).rejects.toThrow(
      TicketAlreadyExistsForEventError,
    );

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('pending');
  });

  it('creates TicketExtraItem rows for each extra in the order', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const extra1 = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Camiseta', priceCents: 5000 },
    });
    const extra2 = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Sticker Pack', priceCents: 1000 },
    });
    await prisma.orderExtra.createMany({
      data: [
        { orderId: order.id, extraId: extra1.id, quantity: 1 },
        { orderId: order.id, extraId: extra2.id, quantity: 1 },
      ],
    });

    const result = await issueTicketForPaidOrder(order.id, order.providerRef!, env);

    const items = await prisma.ticketExtraItem.findMany({
      where: { ticketId: result.ticketId },
      orderBy: { extraId: 'asc' },
    });
    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item.status).toBe('valid');
      const { kind, id } = verifyQrCode(item.code, env);
      expect(kind).toBe('e');
      expect(id).toBe(`${result.ticketId}-${item.extraId}`);
    }

    const extraIds = items.map((i) => i.extraId).sort();
    expect(extraIds).toEqual([extra1.id, extra2.id].sort());
  });

  it('is idempotent for extras — redelivery via already-paid path does not duplicate TicketExtraItem rows', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const extra = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Pôster', priceCents: 2000 },
    });
    await prisma.orderExtra.create({ data: { orderId: order.id, extraId: extra.id, quantity: 1 } });

    // First call: pending → paid, creates ticket + extra item
    const first = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
    // Second call: order.status === 'paid' branch (redelivery crash-recovery path)
    const second = await issueTicketForPaidOrder(order.id, order.providerRef!, env);

    expect(first.ticketId).toBe(second.ticketId);

    // Upsert in the already-paid path must be a no-op — still exactly one item
    const items = await prisma.ticketExtraItem.findMany({ where: { ticketId: first.ticketId } });
    expect(items).toHaveLength(1);
  });

  it('creates no TicketExtraItem rows when the order has no extras', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const result = await issueTicketForPaidOrder(order.id, order.providerRef!, env);

    const items = await prisma.ticketExtraItem.findMany({ where: { ticketId: result.ticketId } });
    expect(items).toHaveLength(0);
  });

  it('extra item codes are unique across two different orders with the same extra', async () => {
    const { user: u1 } = await createUser({ verified: true, email: 'buyer1@jdm.test' });
    const { user: u2 } = await createUser({ verified: true, email: 'buyer2@jdm.test' });
    const { event, tier } = await seedEventAndTier(5);
    const o1 = await createPendingOrder(u1.id, event.id, tier.id);
    const o2 = await createPendingOrder(u2.id, event.id, tier.id);

    const extra = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Exclusivo', priceCents: 3000 },
    });
    await prisma.orderExtra.create({ data: { orderId: o1.id, extraId: extra.id, quantity: 1 } });
    await prisma.orderExtra.create({ data: { orderId: o2.id, extraId: extra.id, quantity: 1 } });

    const r1 = await issueTicketForPaidOrder(o1.id, o1.providerRef!, env);
    const r2 = await issueTicketForPaidOrder(o2.id, o2.providerRef!, env);

    const item1 = await prisma.ticketExtraItem.findFirstOrThrow({
      where: { ticketId: r1.ticketId },
    });
    const item2 = await prisma.ticketExtraItem.findFirstOrThrow({
      where: { ticketId: r2.ticketId },
    });

    expect(item1.code).not.toBe(item2.code);
    expect(item1.ticketId).not.toBe(item2.ticketId);
  });

  it('issues N tickets atomically for a multi-ticket order with mixed extras and cars', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier(10, { maxTicketsPerUser: 10 });

    const car1 = await prisma.car.create({
      data: { userId: user.id, make: 'Toyota', model: 'Supra', year: 1994, nickname: 'Supra' },
    });
    const car2 = await prisma.car.create({
      data: { userId: user.id, make: 'Nissan', model: 'Skyline', year: 1999, nickname: 'GTR' },
    });

    const extra1 = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Camiseta', priceCents: 5000 },
    });
    const extra2 = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Sticker', priceCents: 1000 },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000 * 3,
        quantity: 3,
        method: 'card',
        provider: 'stripe',
        providerRef: `pi_multi_${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
      },
    });
    // OrderExtra rows: extra1 appears in 2 tickets, extra2 in 1
    await prisma.orderExtra.createMany({
      data: [
        { orderId: order.id, extraId: extra1.id, quantity: 2 },
        { orderId: order.id, extraId: extra2.id, quantity: 1 },
      ],
    });

    // Metadata mirrors per-ticket assignments:
    // ticket 0: car1 + extra1 + extra2
    // ticket 1: car2 + extra1
    // ticket 2: no car, no extras
    const metadata: Record<string, string> = {
      orderId: order.id,
      tickets: JSON.stringify([
        { e: [extra1.id, extra2.id], c: car1.id, p: 'ABC1D23' },
        { e: [extra1.id], c: car2.id, p: 'DEF4G56' },
        { e: [] },
      ]),
    };

    const result = await issueTicketForPaidOrder(order.id, order.providerRef!, env, metadata);
    expect(result.ticketId).toBeTruthy();

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const tickets = await prisma.ticket.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(tickets).toHaveLength(3);

    // Ticket 0: car1
    expect(tickets[0]!.carId).toBe(car1.id);
    expect(tickets[0]!.licensePlate).toBe('ABC1D23');
    // Ticket 1: car2
    expect(tickets[1]!.carId).toBe(car2.id);
    expect(tickets[1]!.licensePlate).toBe('DEF4G56');
    // Ticket 2: no car
    expect(tickets[2]!.carId).toBeNull();
    expect(tickets[2]!.licensePlate).toBeNull();

    // Verify per-ticket extras
    const extras0 = await prisma.ticketExtraItem.findMany({
      where: { ticketId: tickets[0]!.id },
      orderBy: { extraId: 'asc' },
    });
    expect(extras0).toHaveLength(2);
    expect(extras0.map((e) => e.extraId).sort()).toEqual([extra1.id, extra2.id].sort());

    const extras1 = await prisma.ticketExtraItem.findMany({
      where: { ticketId: tickets[1]!.id },
    });
    expect(extras1).toHaveLength(1);
    expect(extras1[0]!.extraId).toBe(extra1.id);

    const extras2 = await prisma.ticketExtraItem.findMany({
      where: { ticketId: tickets[2]!.id },
    });
    expect(extras2).toHaveLength(0);

    // All extra item codes are unique and valid
    const allItems = await prisma.ticketExtraItem.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) } },
    });
    expect(allItems).toHaveLength(3);
    for (const item of allItems) {
      expect(item.status).toBe('valid');
      const { kind, id } = verifyQrCode(item.code, env);
      expect(kind).toBe('e');
      expect(id).toBe(`${item.ticketId}-${item.extraId}`);
    }
  });

  it('is idempotent for multi-ticket orders — replay returns same tickets', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier(10, { maxTicketsPerUser: 10 });

    const extra = await prisma.ticketExtra.create({
      data: { eventId: event.id, name: 'Boné', priceCents: 3000 },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000 * 2,
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        providerRef: `pi_idem_${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
      },
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 2 },
    });

    const metadata: Record<string, string> = {
      orderId: order.id,
      tickets: JSON.stringify([{ e: [extra.id] }, { e: [extra.id] }]),
    };

    const first = await issueTicketForPaidOrder(order.id, order.providerRef!, env, metadata);
    const second = await issueTicketForPaidOrder(order.id, order.providerRef!, env, metadata);

    expect(first.ticketId).toBe(second.ticketId);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(2);

    const items = await prisma.ticketExtraItem.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) } },
    });
    expect(items).toHaveLength(2);
  });

  it('refuses multi-ticket order when user already has a valid ticket from another source', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier(10, { maxTicketsPerUser: 2 });

    // Pre-existing comp ticket
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'comp',
        status: 'valid',
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000 * 2,
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        providerRef: `pi_conflict_${Math.random().toString(36).slice(2, 10)}`,
        status: 'pending',
      },
    });

    const metadata: Record<string, string> = {
      orderId: order.id,
      tickets: JSON.stringify([{ e: [] }, { e: [] }]),
    };

    await expect(
      issueTicketForPaidOrder(order.id, order.providerRef!, env, metadata),
    ).rejects.toThrow(TicketAlreadyExistsForEventError);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(0);
  });
});
