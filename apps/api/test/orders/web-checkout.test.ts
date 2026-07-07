import { prisma } from '@jdm/db';
import { createWebCheckoutResponseSchema } from '@jdm/shared/orders';
import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  init: vi.fn(),
  withScope: vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
    callback({ setTag: vi.fn() }),
  ),
}));

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import type { CreateCheckoutSessionInput } from '../../src/services/stripe/index.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const errorResponseSchema = z.object({ error: z.string(), message: z.string().optional() });

const seedPublishedEvent = async (quantityTotal = 10, opts?: { requiresCar?: boolean }) => {
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
      requiresCar: opts?.requiresCar ?? false,
    },
  });
  return { event, tier };
};

const seedExtra = async (
  eventId: string,
  opts?: { quantitySold?: number; quantityTotal?: number },
) => {
  return prisma.ticketExtra.create({
    data: {
      eventId,
      name: 'Camiseta',
      priceCents: 2000,
      currency: 'BRL',
      quantityTotal: opts?.quantityTotal ?? 10,
      quantitySold: opts?.quantitySold ?? 0,
      sortOrder: 0,
    },
  });
};

describe('POST /orders/checkout', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('creates a pending order and returns checkoutUrl', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createWebCheckoutResponseSchema.parse(res.json());
    expect(body.status).toBe('pending');
    expect(body.amountCents).toBe(5500);
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.status).toBe('pending');
    expect(order.providerRef).toBe('pi_test_cs_1');

    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(1);

    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0]!.kind).toBe('createCheckoutSession');
  });

  it('passes correct metadata to Stripe Checkout Session', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const extra = await seedExtra(event.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{ extras: [extra.id] }],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createWebCheckoutResponseSchema.parse(res.json());
    expect(body.amountCents).toBe(7700);

    const csCall = stripe.calls.find((c) => c.kind === 'createCheckoutSession');
    const csPayload = csCall!.payload as CreateCheckoutSessionInput;
    expect(csPayload.metadata.orderId).toBeDefined();
    expect(csPayload.metadata.userId).toBe(user.id);
    expect(csPayload.metadata.eventId).toBe(event.id);
    expect(csPayload.metadata.tierId).toBe(tier.id);
    const successUrl = new URL(csPayload.successUrl);
    const cancelUrl = new URL(csPayload.cancelUrl);
    expect(successUrl.origin + successUrl.pathname).toBe('https://app.jdm.com/success');
    expect(cancelUrl.origin + cancelUrl.pathname).toBe('https://app.jdm.com/cancel');
    expect(successUrl.searchParams.get('orderId')).toBe(csPayload.metadata.orderId);
    expect(cancelUrl.searchParams.get('orderId')).toBe(csPayload.metadata.orderId);
    expect(cancelUrl.searchParams.get('cancelled')).toBe('true');
    const tickets = JSON.parse(csPayload.metadata.tickets as string) as unknown[];
    expect(tickets).toHaveLength(1);
    expect((tickets[0] as { e: string[] }).e).toContain(extra.id);
  });

  it('returns 409 when tier is sold out', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(1);
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('Conflict');
    expect(stripe.calls).toHaveLength(0);
  });

  it('captures Sentry when sweep-triggered Stripe cancel fails during checkout creation', async () => {
    const cancelErr = new Error('stripe cancel failed');
    stripe.cancelPaymentIntent = (paymentIntentId) => {
      stripe.calls.push({ kind: 'cancelPaymentIntent', payload: { paymentIntentId } });
      return Promise.reject(cancelErr);
    };

    const { user } = await createUser({ verified: true });
    const { user: user2 } = await createUser({ email: 'user2@jdm.test', verified: true });
    const { event, tier } = await seedPublishedEvent(1);

    await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_checkout_abandoned',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user2.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(201);
    await vi.waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledWith(cancelErr);
    });
  });

  it('returns 401 for unauthenticated requests', async () => {
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 422 when successUrl is missing', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it('handles extras-only checkout for existing ticket holders', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const extra = await seedExtra(event.id);

    await prisma.ticket.create({
      data: { userId: user.id, eventId: event.id, tierId: tier.id, source: 'comp' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        extrasOnly: true,
        tickets: [{ extras: [extra.id] }],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createWebCheckoutResponseSchema.parse(res.json());
    expect(body.amountCents).toBe(2200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.kind).toBe('extras_only');

    const tierReloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierReloaded.quantitySold).toBe(0);
  });

  it('releases capacity on Stripe checkout session creation failure', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(5);

    stripe.createCheckoutSession = () => {
      return Promise.reject(new Error('Stripe API error'));
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(500);

    const tierReloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierReloaded.quantitySold).toBe(0);
  });

  it('sets checkout session expiry aligned with order expiry', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(201);
    const csCall = stripe.calls.find((c) => c.kind === 'createCheckoutSession');
    const csPayload = csCall!.payload as CreateCheckoutSessionInput;
    expect(csPayload.expiresAt).toBeDefined();
    const nowSec = Math.floor(Date.now() / 1000);
    // Stripe minimum is 30 min (1800s); allow small clock drift
    expect(csPayload.expiresAt!).toBeGreaterThan(nowSec + 1780);
    expect(csPayload.expiresAt!).toBeLessThanOrEqual(nowSec + 1820);
  });

  it('succeeds when Stripe returns null payment_intent on session', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    stripe.nextCheckoutSession = {
      id: 'cs_test_null_pi',
      url: 'https://checkout.stripe.com/cs_test_null_pi',
      paymentIntentId: null,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        method: 'card',
        tickets: [{}],
        successUrl: 'https://app.jdm.com/success',
        cancelUrl: 'https://app.jdm.com/cancel',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = createWebCheckoutResponseSchema.parse(res.json());
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_null_pi');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.status).toBe('pending');
    expect(order.providerRef).toBeNull();
  });
});
