import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issueTicketsForMixedOrder } from '../../src/services/tickets/issue.js';
import { resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedUser = async () =>
  prisma.user.create({
    data: {
      email: `u-${Math.random().toString(36).slice(2, 8)}@test.com`,
      name: 'Test User',
      emailVerifiedAt: new Date(),
    },
  });

const seedPublishedEvent = async (title = 'Evento') => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: 'desc',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
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
      currency: 'BRL',
      quantityTotal: 10,
      quantitySold: 0,
    },
  });
  return { event, tier };
};

const seedExtra = async (eventId: string, name = 'Camiseta') =>
  prisma.ticketExtra.create({
    data: {
      eventId,
      name,
      priceCents: 2000,
      currency: 'BRL',
      quantityTotal: 10,
      quantitySold: 0,
      sortOrder: 0,
    },
  });

const seedActiveProduct = async () => {
  const productType = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'desc',
      productTypeId: productType.id,
      basePriceCents: 9000,
      currency: 'BRL',
      status: 'active',
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'M',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 9000,
      quantityTotal: 10,
      quantitySold: 0,
      attributes: { size: 'M' },
      active: true,
    },
  });
  return { product, variant };
};

const seedExistingTicket = async (userId: string, eventId: string, tierId: string) =>
  prisma.ticket.create({
    data: {
      userId,
      eventId,
      tierId,
      source: 'purchase',
      status: 'valid',
    },
  });

describe('issueTicketsForMixedOrder — extras_only mixed-cart coverage (JDMA-462)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    // resetDatabase runs in beforeEach
  });

  it('attaches extras_only line to existing ticket when paired with a product item', async () => {
    const user = await seedUser();
    const { event, tier } = await seedPublishedEvent('Evento E1');
    const extra = await seedExtra(event.id);
    const { variant } = await seedActiveProduct();

    const existingTicket = await seedExistingTicket(user.id, event.id, tier.id);

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: 'checking_out' },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        eventId: null,
        tierId: null,
        kind: 'mixed',
        amountCents: 11_000,
        quantity: 2,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_extras_only_product',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        fulfillmentMethod: 'pickup',
      },
    });
    await prisma.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          kind: 'extras',
          eventId: event.id,
          extraId: extra.id,
          quantity: 1,
          unitPriceCents: 2000,
          subtotalCents: 2000,
        },
        {
          orderId: order.id,
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 9000,
          subtotalCents: 9000,
        },
      ],
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 1 },
    });

    const results = await issueTicketsForMixedOrder(order.id, 'pi_extras_only_product', env);

    expect(results).toHaveLength(1);
    expect(results[0]!.ticketId).toBe(existingTicket.id);
    expect(results[0]!.eventId).toBe(event.id);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('paid');

    const extraItems = await prisma.ticketExtraItem.findMany({
      where: { ticketId: existingTicket.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(extraItems).toHaveLength(1);
    expect(extraItems[0]!.extraId).toBe(extra.id);
    expect(extraItems[0]!.status).toBe('valid');
  });

  it('issues new ticket for one event AND attaches extras_only to existing ticket on another event', async () => {
    const user = await seedUser();
    const { event: ev1, tier: tier1 } = await seedPublishedEvent('Evento Existing');
    const extra1 = await seedExtra(ev1.id, 'Brinde');
    const { event: ev2, tier: tier2 } = await seedPublishedEvent('Evento Novo');

    const existingTicket = await seedExistingTicket(user.id, ev1.id, tier1.id);

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: 'checking_out' },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        eventId: null,
        tierId: null,
        kind: 'mixed',
        amountCents: 7000,
        quantity: 2,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_extras_only_other_ticket',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        fulfillmentMethod: 'pickup',
      },
    });
    await prisma.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          kind: 'extras',
          eventId: ev1.id,
          extraId: extra1.id,
          quantity: 1,
          unitPriceCents: 2000,
          subtotalCents: 2000,
        },
        {
          orderId: order.id,
          kind: 'ticket',
          eventId: ev2.id,
          tierId: tier2.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      ],
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra1.id, quantity: 1 },
    });

    const results = await issueTicketsForMixedOrder(order.id, 'pi_extras_only_other_ticket', env);

    expect(results).toHaveLength(2);
    const ev2Result = results.find((r) => r.eventId === ev2.id);
    const ev1Result = results.find((r) => r.eventId === ev1.id);
    expect(ev2Result).toBeDefined();
    expect(ev1Result).toBeDefined();
    expect(ev1Result!.ticketId).toBe(existingTicket.id);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('paid');

    // Extras attached to the existing ticket on ev1, NOT to the new ticket on ev2
    const ev1ExtraItems = await prisma.ticketExtraItem.findMany({
      where: { ticketId: existingTicket.id },
    });
    expect(ev1ExtraItems).toHaveLength(1);
    expect(ev1ExtraItems[0]!.extraId).toBe(extra1.id);

    const newTicket = await prisma.ticket.findFirstOrThrow({
      where: { orderId: order.id, eventId: ev2.id, status: 'valid' },
    });
    expect(newTicket.tierId).toBe(tier2.id);
    const newTicketExtras = await prisma.ticketExtraItem.findMany({
      where: { ticketId: newTicket.id },
    });
    expect(newTicketExtras).toHaveLength(0);
  });
});

// Regression coverage for the kind-routing fix on JDMA-462 PR #209: any cart
// with multiple lines must produce a `mixed` Order so settlement reads scope
// from `OrderItem` rows. Before the fix, multi-line ticket-only and
// extras-only carts kept `kind='ticket'`/`'extras_only'` and reached
// `issueTicketForPaidOrder` with null `eventId`/`tierId`, throwing
// `missing eventId/tierId/event for ticket issuance`.
describe('issueTicketsForMixedOrder — multi-line homogeneous carts (JDMA-462)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('issues one ticket per ticket OrderItem when a single mixed Order spans two events', async () => {
    const user = await seedUser();
    const { event: ev1, tier: tier1 } = await seedPublishedEvent('Evento A');
    const { event: ev2, tier: tier2 } = await seedPublishedEvent('Evento B');

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: 'checking_out' },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        eventId: null,
        tierId: null,
        kind: 'mixed',
        amountCents: 10_000,
        quantity: 2,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_multi_event_tickets',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        fulfillmentMethod: 'pickup',
      },
    });
    await prisma.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          kind: 'ticket',
          eventId: ev1.id,
          tierId: tier1.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
        {
          orderId: order.id,
          kind: 'ticket',
          eventId: ev2.id,
          tierId: tier2.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      ],
    });

    const results = await issueTicketsForMixedOrder(order.id, 'pi_multi_event_tickets', env);

    expect(results).toHaveLength(2);
    const eventIds = results.map((r) => r.eventId).sort();
    expect(eventIds).toEqual([ev1.id, ev2.id].sort());

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('paid');

    const tickets = await prisma.ticket.findMany({
      where: { orderId: order.id, status: 'valid' },
    });
    expect(tickets).toHaveLength(2);
    expect(new Set(tickets.map((t) => t.eventId))).toEqual(new Set([ev1.id, ev2.id]));
  });

  it('attaches extras to pre-existing tickets on each event when a single mixed Order has only extras lines spanning two events', async () => {
    const user = await seedUser();
    const { event: ev1, tier: tier1 } = await seedPublishedEvent('Evento C');
    const { event: ev2, tier: tier2 } = await seedPublishedEvent('Evento D');
    const extra1 = await seedExtra(ev1.id, 'Brinde A');
    const extra2 = await seedExtra(ev2.id, 'Brinde B');

    const ticket1 = await seedExistingTicket(user.id, ev1.id, tier1.id);
    const ticket2 = await seedExistingTicket(user.id, ev2.id, tier2.id);

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: 'checking_out' },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        eventId: null,
        tierId: null,
        kind: 'mixed',
        amountCents: 4000,
        quantity: 2,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_multi_event_extras_only',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        fulfillmentMethod: 'pickup',
      },
    });
    await prisma.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          kind: 'extras',
          eventId: ev1.id,
          extraId: extra1.id,
          quantity: 1,
          unitPriceCents: 2000,
          subtotalCents: 2000,
        },
        {
          orderId: order.id,
          kind: 'extras',
          eventId: ev2.id,
          extraId: extra2.id,
          quantity: 1,
          unitPriceCents: 2000,
          subtotalCents: 2000,
        },
      ],
    });
    await prisma.orderExtra.createMany({
      data: [
        { orderId: order.id, extraId: extra1.id, quantity: 1 },
        { orderId: order.id, extraId: extra2.id, quantity: 1 },
      ],
    });

    const results = await issueTicketsForMixedOrder(order.id, 'pi_multi_event_extras_only', env);

    expect(results).toHaveLength(2);
    const byEvent = new Map(results.map((r) => [r.eventId, r.ticketId]));
    expect(byEvent.get(ev1.id)).toBe(ticket1.id);
    expect(byEvent.get(ev2.id)).toBe(ticket2.id);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('paid');

    // Extras must be scoped per event so we never cross-attach.
    const ticket1Extras = await prisma.ticketExtraItem.findMany({
      where: { ticketId: ticket1.id },
    });
    expect(ticket1Extras.map((e) => e.extraId)).toEqual([extra1.id]);

    const ticket2Extras = await prisma.ticketExtraItem.findMany({
      where: { ticketId: ticket2.id },
    });
    expect(ticket2Extras.map((e) => e.extraId)).toEqual([extra2.id]);

    // No new tickets created on extras-only paths.
    const newTickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(newTickets).toHaveLength(0);
  });
});
