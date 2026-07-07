import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /uploads/presign { kind: event_cover }', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const body = { kind: 'event_cover', contentType: 'image/jpeg', size: 50_000 };

  it('401 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/uploads/presign', payload: body });
    expect(res.statusCode).toBe(401);
  });

  it('403 for plain user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('200 for organizer', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json<{ objectKey: string }>();
    expect(json.objectKey.startsWith(`event_cover/${user.id}/`)).toBe(true);
  });

  it('200 for admin', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true, role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });

  it('still allows avatar for plain user', async () => {
    const { user } = await createUser({ email: 'u2@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 50_000 },
    });
    expect(res.statusCode).toBe(200);
  });
});
