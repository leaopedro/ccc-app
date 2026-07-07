import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  EventPickupAssignmentUnavailableError,
  assignEventPickupTicket,
} from '../../src/services/store/event-pickup.js';
import { resetDatabase } from '../helpers.js';

const env = loadEnv();

const createUser = async (email = 'pickup@jdm.test') =>
  prisma.user.create({
    data: {
      email,
      name: 'Pickup',
      passwordHash: 'x',
      role: 'user',
      emailVerifiedAt: new Date(),
    },
  });

const createEvent = async (title = 'Pickup Event') => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: 'desc',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 10,
      maxTicketsPerUser: 5,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 10,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

const createPickupOrder = async (userId: string, pickupEventId: string) => {
  const cart = await prisma.cart.create({ data: { userId, status: 'checking_out' } });
  return prisma.order.create({
    data: {
      userId,
      cartId: cart.id,
      kind: 'mixed',
      amountCents: 9000,
      quantity: 1,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      fulfillmentMethod: 'pickup',
      status: 'pending',
      pickupEventId,
    },
  });
};

const createTicket = async (
  userId: string,
  eventId: string,
  tierId: string,
  opts: { orderId?: string | null; createdAt?: Date; status?: 'valid' | 'used' | 'revoked' } = {},
) =>
  prisma.ticket.create({
    data: {
      userId,
      eventId,
      tierId,
      orderId: opts.orderId ?? null,
      status: opts.status ?? 'valid',
      source: 'purchase',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });

describe('assignEventPickupTicket precedence', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('binds to a same-order ticket when the pickup order also issued tickets for the event', async () => {
    const user = await createUser();
    const { event, tier } = await createEvent();
    const order = await createPickupOrder(user.id, event.id);

    // Pre-existing ticket from earlier purchase (different order). Latest fallback ignores this.
    const otherOrder = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'ticket',
        amountCents: 5000,
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        eventId: event.id,
        tierId: tier.id,
      },
    });
    await createTicket(user.id, event.id, tier.id, {
      orderId: otherOrder.id,
      createdAt: new Date(Date.now() - 5_000),
    });

    // Same-order ticket — must win.
    const sameOrderTicket = await createTicket(user.id, event.id, tier.id, {
      orderId: order.id,
      createdAt: new Date(Date.now() - 1_000),
    });

    const assignedId = await assignEventPickupTicket(order.id, env);
    expect(assignedId).toBe(sameOrderTicket.id);

    const refreshed = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { pickupTicketId: true },
    });
    expect(refreshed.pickupTicketId).toBe(sameOrderTicket.id);
  });

  it('falls back to the latest valid existing ticket when no same-order ticket exists', async () => {
    const user = await createUser();
    const { event, tier } = await createEvent();
    const order = await createPickupOrder(user.id, event.id);

    const olderOrder = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'ticket',
        amountCents: 5000,
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        eventId: event.id,
        tierId: tier.id,
      },
    });
    const newerOrder = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'ticket',
        amountCents: 5000,
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        eventId: event.id,
        tierId: tier.id,
      },
    });

    await createTicket(user.id, event.id, tier.id, {
      orderId: olderOrder.id,
      createdAt: new Date(Date.now() - 60_000),
    });
    const latest = await createTicket(user.id, event.id, tier.id, {
      orderId: newerOrder.id,
      createdAt: new Date(Date.now() - 1_000),
    });

    const assignedId = await assignEventPickupTicket(order.id, env);
    expect(assignedId).toBe(latest.id);

    const refreshed = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { pickupTicketId: true },
    });
    expect(refreshed.pickupTicketId).toBe(latest.id);
  });

  it('skips revoked tickets when picking the latest fallback', async () => {
    const user = await createUser();
    const { event, tier } = await createEvent();
    const order = await createPickupOrder(user.id, event.id);

    const validOlder = await createTicket(user.id, event.id, tier.id, {
      createdAt: new Date(Date.now() - 60_000),
    });
    await createTicket(user.id, event.id, tier.id, {
      createdAt: new Date(Date.now() - 1_000),
      status: 'revoked',
    });

    const assignedId = await assignEventPickupTicket(order.id, env);
    expect(assignedId).toBe(validOlder.id);
  });

  it('throws when no valid ticket exists for the pickup event', async () => {
    const user = await createUser();
    const { event } = await createEvent();
    const order = await createPickupOrder(user.id, event.id);

    await expect(assignEventPickupTicket(order.id, env)).rejects.toBeInstanceOf(
      EventPickupAssignmentUnavailableError,
    );
  });

  it('is idempotent: returns existing pickupTicketId without re-querying', async () => {
    const user = await createUser();
    const { event, tier } = await createEvent();
    const order = await createPickupOrder(user.id, event.id);

    const existing = await createTicket(user.id, event.id, tier.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { pickupTicketId: existing.id },
    });

    const assignedId = await assignEventPickupTicket(order.id, env);
    expect(assignedId).toBe(existing.id);
  });
});
