import { prisma } from '@jdm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';

import { bearer, createUser, makeApp, resetDatabase } from './helpers.js';

const env = loadEnv();

describe('POST /me/device-tokens', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/me/device-tokens' });
    expect(res.statusCode).toBe(401);
  });

  it('400 on malformed body', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, user.id) },
      payload: { expoPushToken: 'too-short', platform: 'pc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('200 registers a new token', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, user.id) },
      payload: { expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    expect(res.statusCode).toBe(200);
    const rows = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.expoPushToken).toBe('ExponentPushToken[abc1234567]');
    expect(rows[0]?.platform).toBe('ios');
  });

  it('200 upserts and bumps lastSeenAt on re-register', async () => {
    const { user } = await createUser({ verified: true });
    const auth = { authorization: bearer(env, user.id) };
    const payload = { expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' as const };

    await app.inject({ method: 'POST', url: '/me/device-tokens', headers: auth, payload });
    const first = await prisma.deviceToken.findFirstOrThrow({ where: { userId: user.id } });
    await new Promise((r) => setTimeout(r, 10));
    await app.inject({ method: 'POST', url: '/me/device-tokens', headers: auth, payload });
    const second = await prisma.deviceToken.findFirstOrThrow({ where: { userId: user.id } });

    const rows = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it('isolates tokens per user', async () => {
    const { user: u1 } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'b@jdm.test', verified: true });

    await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, u1.id) },
      payload: { expoPushToken: 'ExponentPushToken[u1tok123456]', platform: 'ios' },
    });
    await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, u2.id) },
      payload: { expoPushToken: 'ExponentPushToken[u2tok123456]', platform: 'android' },
    });

    expect(await prisma.deviceToken.count({ where: { userId: u1.id } })).toBe(1);
    expect(await prisma.deviceToken.count({ where: { userId: u2.id } })).toBe(1);
  });
});

describe('DELETE /me/device-tokens/:token', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('removes only the calling user’s row for that token', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[xxx]', platform: 'ios' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/me/device-tokens/ExponentPushToken%5Bxxx%5D',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.deviceToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('returns 204 when token does not exist (idempotent)', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'DELETE',
      url: '/me/device-tokens/ExponentPushToken%5Bnope%5D',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
  });
});
