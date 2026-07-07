import { prisma } from '@jdm/db';
import { myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { verifyTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedTicketFor = async (userId: string, opts: { past?: boolean } = {}) => {
  const when = opts.past ? Date.now() - 30 * 86400_000 : Date.now() + 86400_000;
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(when),
      endsAt: new Date(when + 3600_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 1,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 1,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  return prisma.ticket.create({
    data: { userId, eventId: event.id, tierId: tier.id, source: 'purchase' },
  });
};

describe('GET /me/tickets', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns only the caller tickets with a valid signed code', async () => {
    const { user } = await createUser({ verified: true });
    const other = await createUser({ email: 'b@jdm.test', verified: true });
    const mine = await seedTicketFor(user.id);
    await seedTicketFor(other.user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = myTicketsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(mine.id);
    expect(verifyTicketCode(body.items[0]!.code, env)).toBe(mine.id);
  });

  it('lists upcoming first then past, sorted by event startsAt', async () => {
    const { user } = await createUser({ verified: true });
    await seedTicketFor(user.id, { past: true });
    await seedTicketFor(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    const body = myTicketsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);
    expect(new Date(body.items[0]!.event.startsAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(body.items[1]!.event.startsAt).getTime()).toBeLessThan(Date.now());
  });

  it('includes extras array with extra items when present', async () => {
    const { user } = await createUser({ verified: true });
    const ticket = await seedTicketFor(user.id);

    const extra = await prisma.ticketExtra.create({
      data: {
        eventId: ticket.eventId,
        name: 'Camiseta',
        priceCents: 2000,
        quantityTotal: 10,
        sortOrder: 0,
      },
    });

    await prisma.ticketExtraItem.create({
      data: {
        ticketId: ticket.id,
        extraId: extra.id,
        code: `extra-code-${ticket.id}`,
        status: 'valid',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = myTicketsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.extras).toHaveLength(1);
    expect(body.items[0]!.extras[0]!.extraName).toBe('Camiseta');
    expect(body.items[0]!.extras[0]!.status).toBe('valid');
    expect(body.items[0]!.extras[0]!.code).toBe(`extra-code-${ticket.id}`);
  });

  it('returns empty extras array when ticket has no extras', async () => {
    const { user } = await createUser({ verified: true });
    await seedTicketFor(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = myTicketsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.extras).toEqual([]);
  });

  it('returns linked pickup orders only on the bound ticket', async () => {
    const { user } = await createUser({ verified: true });
    const ticketA = await seedTicketFor(user.id);
    const ticketB = await seedTicketFor(user.id);

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
        name: 'Preto — M',
        sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        priceCents: 9000,
        quantityTotal: 10,
        quantitySold: 1,
        attributes: { size: 'M' },
        active: true,
      },
    });
    const pickupOrder = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 9000,
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        fulfillmentMethod: 'pickup',
        status: 'paid',
        paidAt: new Date(),
        pickupEventId: ticketA.eventId,
        pickupTicketId: ticketA.id,
        items: {
          create: {
            kind: 'product',
            variantId: variant.id,
            quantity: 2,
            unitPriceCents: 9000,
            subtotalCents: 18000,
          },
        },
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

    const a = body.items.find((t) => t.id === ticketA.id)!;
    const b = body.items.find((t) => t.id === ticketB.id)!;
    expect(a.pickupOrders).toHaveLength(1);
    expect(a.pickupOrders[0]!.orderId).toBe(pickupOrder.id);
    expect(a.pickupOrders[0]!.items[0]!.productTitle).toBe('Camiseta JDM');
    expect(a.pickupOrders[0]!.items[0]!.variantName).toBe('Preto — M');
    expect(a.pickupOrders[0]!.items[0]!.quantity).toBe(2);
    expect(b.pickupOrders).toEqual([]);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/tickets' });
    expect(res.statusCode).toBe(401);
  });
});
