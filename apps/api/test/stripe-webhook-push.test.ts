import { prisma } from '@jdm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { DevPushSender } from '../src/services/push/dev.js';
import { buildFakeStripe } from '../src/services/stripe/fake.js';

import { createUser, resetDatabase } from './helpers.js';

const env = loadEnv();

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

describe('Stripe webhook -> ticket.confirmed push', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let stripe: ReturnType<typeof buildFakeStripe>;
  let push: DevPushSender;

  beforeAll(async () => {
    stripe = buildFakeStripe();
    push = new DevPushSender();
    app = await buildApp(env, { stripe, push });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    push.clear();
  });

  const seedOrderAndEvent = async (userId: string) => {
    const event = await prisma.event.create({
      data: {
        slug: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: 'JDM Spring Meetup',
        description: 'd',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600_000),
        type: 'meeting',
        status: 'published',
        capacity: 100,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 5000, quantityTotal: 100 },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
      },
    });
    return { event, order };
  };

  const injectWebhook = async (
    app: Awaited<ReturnType<typeof buildApp>>,
    eventId: string,
    paymentIntentId: string,
    orderId: string,
  ) => {
    stripe.nextEvent = {
      id: eventId,
      type: 'payment_intent.succeeded',
      data: { object: { id: paymentIntentId, metadata: { orderId } } },
    };
    return app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 't=1,v1=x', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });
  };

  it('fires push and writes Notification row on payment_intent.succeeded', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const { order } = await seedOrderAndEvent(user.id);

    const res = await injectWebhook(app, 'evt_push_t8_a', 'pi_t8_a', order.id);
    expect(res.statusCode).toBe(200);

    expect(push.captured).toHaveLength(1);
    expect(push.captured[0]?.title.toLowerCase()).toContain('ingresso');
    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notif.dedupeKey).toBe(order.id);
    expect(notif.sentAt).toBeInstanceOf(Date);
  });

  it('does not double-send on webhook redelivery', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const { order } = await seedOrderAndEvent(user.id);

    await injectWebhook(app, 'evt_push_t8_b', 'pi_t8_b', order.id);
    push.clear();
    // Redelivery of same Stripe event id — markProcessed deduplicates it.
    await injectWebhook(app, 'evt_push_t8_b', 'pi_t8_b', order.id);

    expect(push.captured).toHaveLength(0);
    const notifs = await prisma.notification.findMany({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notifs).toHaveLength(1);
  });

  it('does not block ticket issuance if user has no device tokens', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedOrderAndEvent(user.id);

    const res = await injectWebhook(app, 'evt_push_t8_c', 'pi_t8_c', order.id);
    expect(res.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    expect(ticket.status).toBe('valid');
    // Notification row IS written even with no tokens; sentAt remains null.
    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notif.sentAt).toBeNull();
  });
});
