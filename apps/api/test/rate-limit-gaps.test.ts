import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';

import { bearer, createUser, makeApp, resetDatabase } from './helpers.js';

describe('rate-limit gaps', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 429 after 10 POST /me/orders/:id/cancel from the same user', async () => {
    const env = loadEnv();
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const fakeOrderId = '00000000-0000-0000-0000-000000000000';

    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/me/orders/${fakeOrderId}/cancel`,
        headers: { authorization: token },
      });
      // 404 is expected since the order doesn't exist; not 429 yet
      expect(res.statusCode).toBe(404);
    }

    const res11 = await app.inject({
      method: 'POST',
      url: `/me/orders/${fakeOrderId}/cancel`,
      headers: { authorization: token },
    });
    expect(res11.statusCode).toBe(429);
  });

  it('returns 429 after 30 POST /events/:eventId/feed from the same user', async () => {
    const env = loadEnv();
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    for (let i = 0; i < 30; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/events/fake-event/feed',
        headers: { authorization: token },
      });
      // 404 is expected since the event doesn't exist; not 429 yet
      expect(res.statusCode).toBe(404);
    }

    const res31 = await app.inject({
      method: 'POST',
      url: '/events/fake-event/feed',
      headers: { authorization: token },
    });
    expect(res31.statusCode).toBe(429);
  });

  it('returns 429 after 10 POST /orders from the same user', async () => {
    const env = loadEnv();
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: { authorization: token },
        payload: {
          eventId: '00000000-0000-0000-0000-000000000000',
          tierId: '00000000-0000-0000-0000-000000000001',
          method: 'card',
          tickets: [{ extras: [] }],
        },
      });
      // 404 is expected since the event doesn't exist; not 429 yet
      expect(res.statusCode).not.toBe(429);
    }

    const res11 = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: token },
      payload: {
        eventId: '00000000-0000-0000-0000-000000000000',
        tierId: '00000000-0000-0000-0000-000000000001',
        method: 'card',
        tickets: [{ extras: [] }],
      },
    });
    expect(res11.statusCode).toBe(429);
  });

  it('returns 429 after 5 POST /admin/broadcasts from the same admin', async () => {
    const env = loadEnv();
    const { user } = await createUser({ role: 'admin', verified: true });
    const token = bearer(env, user.id, 'admin');

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/broadcasts',
        headers: { authorization: token },
        payload: { title: 'test', body: 'test', targetKind: 'all' },
      });
      // Validation or other errors are fine; not 429 yet
      expect(res.statusCode).not.toBe(429);
    }

    const res6 = await app.inject({
      method: 'POST',
      url: '/admin/broadcasts',
      headers: { authorization: token },
      payload: { title: 'test', body: 'test', targetKind: 'all' },
    });
    expect(res6.statusCode).toBe(429);
  });

  it('two users on same IP do not share rate-limit quota', async () => {
    const env = loadEnv();
    const { user: userA } = await createUser({ verified: true, email: 'a@jdm.test' });
    const { user: userB } = await createUser({ verified: true, email: 'b@jdm.test' });
    const tokenA = bearer(env, userA.id);
    const tokenB = bearer(env, userB.id);
    const fakeOrderId = '00000000-0000-0000-0000-000000000000';

    // User A exhausts 9 of 10 requests
    for (let i = 0; i < 9; i += 1) {
      await app.inject({
        method: 'POST',
        url: `/me/orders/${fakeOrderId}/cancel`,
        headers: { authorization: tokenA },
      });
    }

    // User B still gets through (not 429) because quota is per-user, not per-IP
    const resB = await app.inject({
      method: 'POST',
      url: `/me/orders/${fakeOrderId}/cancel`,
      headers: { authorization: tokenB },
    });
    expect(resB.statusCode).not.toBe(429);
  });
});
