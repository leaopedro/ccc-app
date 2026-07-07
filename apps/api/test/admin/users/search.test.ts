import { adminUserSearchResponseSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('GET /admin/users', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 for staff role', async () => {
    const { user } = await createUser({ email: 's@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns all users for organizer', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    await createUser({ email: 'alice@jdm.test', name: 'Alice', verified: true });
    await createUser({ email: 'bob@jdm.test', name: 'Bob', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserSearchResponseSchema.parse(res.json());
    expect(body.items.length).toBe(3);
    expect(body.nextCursor).toBeNull();
  });

  it('filters by name fragment (case-insensitive)', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    await createUser({ email: 'alice@jdm.test', name: 'Alice Santos', verified: true });
    await createUser({ email: 'bob@jdm.test', name: 'Bob Silva', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/users?q=alice',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserSearchResponseSchema.parse(res.json());
    expect(body.items.length).toBe(1);
    expect(body.items[0]!.name).toBe('Alice Santos');
  });

  it('filters by email fragment', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    await createUser({ email: 'alice@example.com', name: 'Alice', verified: true });
    await createUser({ email: 'bob@jdm.test', name: 'Bob', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/users?q=example.com',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminUserSearchResponseSchema.parse(res.json());
    expect(body.items.length).toBe(1);
    expect(body.items[0]!.email).toBe('alice@example.com');
  });

  it('paginates with cursor', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    for (let i = 0; i < 5; i++) {
      await createUser({ email: `user${i}@jdm.test`, name: `User ${i}`, verified: true });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/admin/users?limit=3',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = adminUserSearchResponseSchema.parse(page1.json());
    expect(body1.items.length).toBe(3);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: 'GET',
      url: `/admin/users?limit=3&cursor=${body1.nextCursor}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(page2.statusCode).toBe(200);
    const body2 = adminUserSearchResponseSchema.parse(page2.json());
    expect(body2.items.length).toBe(3);

    const allIds = [...body1.items.map((i) => i.id), ...body2.items.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(6);
  });

  it('returns 400 for malformed cursor', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users?cursor=not-valid',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(400);
  });
});
