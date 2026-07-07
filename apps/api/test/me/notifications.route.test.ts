import { prisma } from '@jdm/db';
import {
  notificationListResponseSchema,
  notificationMarkReadResponseSchema,
  notificationUnreadCountResponseSchema,
} from '@jdm/shared/notifications';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('/me/notifications routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const seed = async (userId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      await prisma.notification.create({
        data: {
          userId,
          kind: 'broadcast',
          dedupeKey: `b${i}`,
          title: `t${i}`,
          body: `b${i}`,
          data: {},
        },
      });
    }
  };

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('lists notifications, newest first, with destination round-trip', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'ticket.confirmed',
        dedupeKey: 'order-1',
        title: 'Ingresso confirmado',
        body: 'Seu ingresso está pronto.',
        data: { orderId: 'order-1' },
        destination: { kind: 'tickets' },
      },
    });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'broadcast',
        dedupeKey: 'broadcast-1',
        title: 'Novidade',
        body: 'corpo',
        data: {},
        destination: { kind: 'event', eventId: 'evt-1' },
      },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/notifications',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = notificationListResponseSchema.parse(res.json());
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0]?.title).toBe('Novidade');
    expect(body.notifications[0]?.destination).toEqual({ kind: 'event', eventId: 'evt-1' });
  });

  it('paginates with a cursor', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seed(user.id, 25);

    const env = loadEnv();
    const first = await app.inject({
      method: 'GET',
      url: '/me/notifications?limit=10',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = notificationListResponseSchema.parse(first.json());
    expect(firstBody.notifications).toHaveLength(10);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/me/notifications?limit=10&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = notificationListResponseSchema.parse(second.json());
    expect(secondBody.notifications).toHaveLength(10);
    const ids = new Set(firstBody.notifications.map((n) => n.id));
    for (const n of secondBody.notifications) expect(ids.has(n.id)).toBe(false);
  });

  it('returns unread count and ignores other users', async () => {
    const { user: alice } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: bob } = await createUser({ email: 'b@jdm.test', verified: true });
    await seed(alice.id, 3);
    await seed(bob.id, 5);
    const aliceRows = await prisma.notification.findMany({ where: { userId: alice.id } });
    await prisma.notification.update({
      where: { id: aliceRows[0]!.id },
      data: { readAt: new Date() },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/notifications/unread-count',
      headers: { authorization: bearer(env, alice.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(notificationUnreadCountResponseSchema.parse(res.json())).toEqual({ unread: 2 });
  });

  it('marks a notification as read once', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    const n = await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'broadcast',
        dedupeKey: 'b1',
        title: 't',
        body: 'b',
        data: {},
      },
    });

    const env = loadEnv();
    const res1 = await app.inject({
      method: 'POST',
      url: `/me/notifications/${n.id}/read`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = notificationMarkReadResponseSchema.parse(res1.json());
    expect(body1.readAt).toBeTypeOf('string');

    const res2 = await app.inject({
      method: 'POST',
      url: `/me/notifications/${n.id}/read`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = notificationMarkReadResponseSchema.parse(res2.json());
    expect(body2.readAt).toBe(body1.readAt);
  });

  it('refuses to mark another user notification as read', async () => {
    const { user: alice } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: bob } = await createUser({ email: 'b@jdm.test', verified: true });
    const n = await prisma.notification.create({
      data: {
        userId: bob.id,
        kind: 'broadcast',
        dedupeKey: 'b1',
        title: 't',
        body: 'b',
        data: {},
      },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/me/notifications/${n.id}/read`,
      headers: { authorization: bearer(env, alice.id) },
    });
    expect(res.statusCode).toBe(404);
  });
});
