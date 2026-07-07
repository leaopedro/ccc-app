import { prisma } from '@jdm/db';
import { createPixOrderResponseSchema } from '@jdm/shared/orders';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { AbacatePayUpstreamError } from '../../src/services/abacatepay/index.js';
import { bearer, createUser, makeAppWithFakes, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedPublishedEvent = async (quantityTotal = 10) => {
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
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal,
      sortOrder: 0,
      requiresCar: false,
    },
  });
  return { event, tier };
};

describe('POST /orders (method=pix)', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, abacatepay } = await makeAppWithFakes());
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a pending pix order, sets providerRef, and never sends externalId upstream', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'pix', tickets: [{}] },
    });

    expect(res.statusCode).toBe(201);
    const body = createPixOrderResponseSchema.parse(res.json());
    expect(body.status).toBe('pending');
    expect(body.brCode).toBeTruthy();

    const call = abacatepay.calls.find((c) => c.method === 'createPixBilling');
    expect(call).toBeDefined();
    const input = call?.args[0] as Record<string, unknown>;
    expect(input).not.toHaveProperty('externalId');
    expect((input.metadata as Record<string, string>).orderId).toBe(body.orderId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.method).toBe('pix');
    expect(order.provider).toBe('abacatepay');
    expect(order.providerRef).toBeTruthy();

    // expiresAt mirrors the DB order's 15-minute reservation window, not the
    // AbacatePay billing expiry (which defaults to ~24h and breaks the mm:ss
    // countdown on the checkout-pix screen).
    expect(body.expiresAt).toBe(order.expiresAt?.toISOString());
    const remainingMs = new Date(body.expiresAt).getTime() - Date.now();
    expect(remainingMs).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(remainingMs).toBeGreaterThan(0);

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(1);
  });

  it('returns 502 and rolls back stock when AbacatePay returns an upstream 4xx', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const tierBefore = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });

    abacatepay.nextBillingError = new AbacatePayUpstreamError(
      422,
      '{"success":false,"data":null,"error":"Value should be one of \'object\', \'object\'"}',
      'AbacatePay POST /transparents/create failed: 422',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'pix', tickets: [{}] },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'BadGateway' });

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.quantitySold).toBe(tierBefore.quantitySold);

    const orphan = await prisma.order.findFirst({
      where: { userId: user.id, eventId: event.id },
    });
    expect(orphan?.status).toBe('expired');
  });
});
