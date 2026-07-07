import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const seedEventTierOrder = async (
  userId: string,
  opts?: { quantity?: number; maxTicketsPerUser?: number },
) => {
  const quantity = opts?.quantity ?? 1;
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
      capacity: 5,
      maxTicketsPerUser: opts?.maxTicketsPerUser ?? quantity,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 5,
      quantitySold: quantity,
      sortOrder: 0,
    },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      eventId: event.id,
      tierId: tier.id,
      amountCents: 5000 * quantity,
      quantity,
      method: 'card',
      provider: 'stripe',
      providerRef: 'pi_test_abc',
      status: 'pending',
    },
  });
  return { event, tier, order };
};

describe('POST /stripe/webhook', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when the stripe-signature header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: rawJson({ id: 'evt_1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    stripe.nextSignatureValid = false;
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'bad' },
      payload: rawJson({ id: 'evt_1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts webhook-signature header alias', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);
    stripe.nextEvent = {
      id: 'evt_header_alias_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'webhook-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);
  });

  it('handles payment_intent.succeeded: marks order paid and issues ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_success_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const ticket = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(ticket).not.toBeNull();
  });

  it('is idempotent: redelivery of the same event does not re-issue a ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_success_dup',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(second.statusCode).toBe(200);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(1);
  });

  it('handles payment_intent.payment_failed: marks order failed + releases reservation', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_fail_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('failed');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(0);
  });

  it('releases full tier reservation when payment_failed order quantity is greater than 1', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, order } = await seedEventTierOrder(user.id, { quantity: 3 });

    stripe.nextEvent = {
      id: 'evt_fail_qty_3',
      type: 'payment_intent.payment_failed',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('failed');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);
  });

  it('no-ops on unknown event type', async () => {
    stripe.nextEvent = {
      id: 'evt_unknown_1',
      type: 'charge.captured',
      data: { object: {} },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refunds and dedups when issuance fails with TicketAlreadyExistsForEventError', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier, order } = await seedEventTierOrder(user.id, { maxTicketsPerUser: 1 });

    // Pre-seed a conflicting valid ticket (e.g. comp grant) so
    // issueTicketForPaidOrder throws TicketAlreadyExistsForEventError.
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'comp',
        status: 'valid',
      },
    });

    stripe.nextEvent = {
      id: 'evt_dup_refund',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refunded: true });

    const refundCalls = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]?.payload).toMatchObject({ paymentIntentId: order.providerRef });

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('refunded');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    // No ticket issued for this paid order (the comp ticket is the single valid one).
    const issued = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(issued).toBeNull();

    // Dedup row written so Stripe retries short-circuit.
    const dedupRow = await prisma.paymentWebhookEvent.findFirst({
      where: { eventId: 'evt_dup_refund' },
    });
    expect(dedupRow).not.toBeNull();
  });

  it('allows additional purchase when existing valid tickets are below maxTicketsPerUser', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier, order } = await seedEventTierOrder(user.id, { maxTicketsPerUser: 3 });

    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    stripe.nextEvent = {
      id: 'evt_limit_under_cap',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('paid');

    const orderTickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(orderTickets).toHaveLength(1);

    const refundCalls = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refundCalls).toHaveLength(0);
  });

  it('issues 3 tickets for a multi-ticket order via payment_intent.succeeded', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id, { quantity: 3 });

    const ticketsMeta = [{ e: [] as string[] }, { e: [] as string[] }, { e: [] as string[] }];

    stripe.nextEvent = {
      id: 'evt_multi_3',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: order.providerRef,
          metadata: { orderId: order.id, tickets: JSON.stringify(ticketsMeta) },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(3);
  });

  it('is idempotent for multi-ticket: redelivery does not duplicate tickets', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id, { quantity: 2 });

    const ticketsMeta = [{ e: [] as string[] }, { e: [] as string[] }];

    stripe.nextEvent = {
      id: 'evt_multi_dup',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: order.providerRef,
          metadata: { orderId: order.id, tickets: JSON.stringify(ticketsMeta) },
        },
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(second.statusCode).toBe(200);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(2);
  });

  it('does not mark event processed when dispatch fails with a non-duplicate error', async () => {
    stripe.nextEvent = {
      id: 'evt_dispatch_fail',
      type: 'payment_intent.succeeded',
      // orderId that does not exist -> OrderNotFoundError propagates.
      data: { object: { id: 'pi_test_missing', metadata: { orderId: 'missing-order-id' } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(500);

    const dedupRow = await prisma.paymentWebhookEvent.findFirst({
      where: { eventId: 'evt_dispatch_fail' },
    });
    expect(dedupRow).toBeNull();
  });

  it('refunds and marks processed when payment_intent.succeeded arrives for an expired order', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, order } = await seedEventTierOrder(user.id);

    // Simulate the order having been expired (e.g. via GET /orders/:id lazy expiry)
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'expired', expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.ticketTier.update({ where: { id: tier.id }, data: { quantitySold: 0 } });

    stripe.nextEvent = {
      id: 'evt_expired_order',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refunded: true, reason: 'expired' });

    const refundCalls = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]?.payload).toMatchObject({ paymentIntentId: order.providerRef });

    // No ticket issued
    const ticket = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(ticket).toBeNull();

    // Dedup row written so Stripe retries short-circuit
    const dedupRow = await prisma.paymentWebhookEvent.findFirst({
      where: { eventId: 'evt_expired_order' },
    });
    expect(dedupRow).not.toBeNull();
  });

  it('handles checkout.session.completed: marks order paid and issues ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_cs_completed_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          payment_intent: order.providerRef,
          payment_status: 'paid',
          metadata: { orderId: order.id },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const ticket = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(ticket).not.toBeNull();
  });

  it('handles checkout.session.completed when payload omits payment_intent but session lookup returns it', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextCheckoutSessionPaymentIntentId = order.providerRef;
    stripe.nextEvent = {
      id: 'evt_cs_completed_missing_pi_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_missing_pi',
          payment_intent: null,
          payment_status: 'paid',
          metadata: { orderId: order.id },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const ticket = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(ticket).not.toBeNull();
  });

  it('checkout.session.completed is idempotent with payment_intent.succeeded', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    // First: payment_intent.succeeded settles the order
    stripe.nextEvent = {
      id: 'evt_pi_before_cs',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    // Second: checkout.session.completed arrives (Stripe sends both)
    stripe.nextEvent = {
      id: 'evt_cs_after_pi',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_idem',
          payment_intent: order.providerRef,
          payment_status: 'paid',
          metadata: { orderId: order.id },
        },
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(1);
  });

  it('checkout.session.completed ignores unpaid sessions', async () => {
    stripe.nextEvent = {
      id: 'evt_cs_unpaid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_unpaid',
          payment_intent: null,
          payment_status: 'unpaid',
          metadata: { orderId: 'some-order' },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, ignored: true });
  });

  it('resolves orderId via providerRef fallback when checkout.session metadata lacks orderId', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_cs_fallback_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_fallback',
          metadata: {},
          payment_intent: order.providerRef,
          payment_status: 'paid',
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const ticket = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(ticket).not.toBeNull();
  });

  it('providerRef fallback does not resolve non-stripe orders (cross-provider isolation)', async () => {
    const { user } = await createUser({ verified: true });
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
        capacity: 5,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 5000,
        quantityTotal: 5,
        quantitySold: 1,
        sortOrder: 0,
      },
    });
    const pixOrder = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        quantity: 1,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'pi_shared_ref_123',
        status: 'pending',
      },
    });

    stripe.nextEvent = {
      id: 'evt_cs_cross_provider',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_cross',
          metadata: {},
          payment_intent: 'pi_shared_ref_123',
          payment_status: 'paid',
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, ignored: true });

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: pixOrder.id } });
    expect(reloaded.status).toBe('pending');
  });

  it('handles checkout.session.expired: marks order failed and releases reservation', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_cs_expired_1',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_test_expired',
          payment_intent: order.providerRef,
          payment_status: 'unpaid',
          metadata: { orderId: order.id },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('failed');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(0);
  });

  it('checkout.session.expired no-ops when order already settled', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, order } = await seedEventTierOrder(user.id);

    // Settle order first via payment_intent.succeeded
    stripe.nextEvent = {
      id: 'evt_pi_before_expire',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    // Session expired event arrives late
    stripe.nextEvent = {
      id: 'evt_cs_expired_late',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_test_expired_late',
          payment_intent: order.providerRef,
          payment_status: 'unpaid',
          metadata: { orderId: order.id },
        },
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    // Order stays paid, not flipped to failed
    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    // Tier reservation not released (already consumed by ticket)
    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(1);
  });

  describe('charge.refunded', () => {
    const seedPaidOrder = async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);
      const paid = await prisma.order.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date() },
      });
      return { user, order: paid };
    };

    const refundEvent = (
      eventId: string,
      paymentIntent: string,
      amount: number,
      amountRefunded: number,
    ) => ({
      id: eventId,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${eventId}`,
          payment_intent: paymentIntent,
          amount,
          amount_refunded: amountRefunded,
          refunded: amountRefunded >= amount,
        },
      },
    });

    it('flips paid order to refunded on full refund', async () => {
      const { order } = await seedPaidOrder();
      stripe.nextEvent = refundEvent('evt_charge_refunded_1', order.providerRef!, 5000, 5000);

      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, refunded: true });

      const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(reloaded.status).toBe('refunded');

      const dedup = await prisma.paymentWebhookEvent.findFirst({
        where: { eventId: 'evt_charge_refunded_1' },
      });
      expect(dedup).not.toBeNull();
    });

    it('dedupes redelivered charge.refunded events', async () => {
      const { order } = await seedPaidOrder();
      stripe.nextEvent = refundEvent('evt_charge_refunded_dup', order.providerRef!, 5000, 5000);

      const first = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ deduped: true });

      const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(reloaded.status).toBe('refunded');

      const dedupRows = await prisma.paymentWebhookEvent.count({
        where: { eventId: 'evt_charge_refunded_dup' },
      });
      expect(dedupRows).toBe(1);
    });

    it('rejects partial refund and leaves order paid', async () => {
      const { order } = await seedPaidOrder();
      stripe.nextEvent = refundEvent('evt_charge_partial', order.providerRef!, 5000, 1000);

      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, ignored: true, reason: 'partial-refund' });

      const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(reloaded.status).toBe('paid');
    });

    it('ignores charge.refunded with no matching order', async () => {
      stripe.nextEvent = refundEvent('evt_charge_no_order', 'pi_unknown_xxx', 5000, 5000);

      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, ignored: true });
    });

    it('is idempotent when order is already refunded', async () => {
      const { order } = await seedPaidOrder();
      await prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });

      stripe.nextEvent = refundEvent('evt_charge_already_refunded', order.providerRef!, 5000, 5000);

      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });

      expect(res.statusCode).toBe(200);
      const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(reloaded.status).toBe('refunded');
    });

    it('charge.refunded revokes ticket and extras for a paid order', async () => {
      const { user } = await createUser();
      const { event, tier, order } = await seedEventTierOrder(user.id);

      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date() },
      });
      const ticket = await prisma.ticket.create({
        data: {
          orderId: order.id,
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });

      const chargePayload = {
        id: 'evt_refund_1',
        type: 'charge.refunded',
        data: {
          object: {
            payment_intent: order.providerRef,
            amount: 5000,
            amount_refunded: 5000,
          },
        },
      };

      stripe.nextEvent = chargePayload;
      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'valid' },
        payload: rawJson(chargePayload),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, refunded: true });

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('refunded');

      const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(updatedTicket.status).toBe('revoked');
    });
  });
});
