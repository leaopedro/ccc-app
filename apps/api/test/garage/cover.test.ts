import { prisma } from '@ccc/db';
import { GARAGE_COVER_PRESETS } from '@ccc/shared/garage-covers';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const grantPremium = async (userId: string) =>
  prisma.garage.update({
    where: { userId },
    data: { premiumTier: 'gold', premiumUntil: null },
  });

describe('GET /me/garage/cover/presets', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the full preset list with resolved imageUrl values', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/cover/presets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      presets: { slug: string; label: string; premium: boolean; imageUrl: string }[];
    }>();
    expect(body.presets).toHaveLength(GARAGE_COVER_PRESETS.length);
    for (const preset of body.presets) {
      expect(preset.imageUrl).toMatch(/garage-cover-presets\//);
      expect(preset.imageUrl).toContain(`${preset.slug}@2x.jpg`);
    }
    // sanity: includes the free default + a premium one
    const defaultDoor = body.presets.find((p) => p.slug === 'default-door');
    expect(defaultDoor?.premium).toBe(false);
    const tokyo = body.presets.find((p) => p.slug === 'tokyo-wangan');
    expect(tokyo?.premium).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/garage/cover/presets' });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits to 60/min/ip — 61st call returns 429', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const token = bearer(env, user.id);
    for (let i = 0; i < 60; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/me/garage/cover/presets',
        headers: { authorization: token },
      });
      expect(res.statusCode).toBe(200);
    }
    const res61 = await app.inject({
      method: 'GET',
      url: '/me/garage/cover/presets',
      headers: { authorization: token },
    });
    expect(res61.statusCode).toBe(429);
  });
});

describe('POST /me/garage/cover/upload', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 premium_required for free users (no presign emitted)', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/cover/upload',
      headers: { authorization: bearer(env, user.id) },
      payload: { contentType: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('premium_required');
  });

  it('returns presign URL with garage-cover/<userId>/ key for premium users', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/cover/upload',
      headers: { authorization: bearer(env, user.id) },
      payload: { contentType: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      uploadUrl: string;
      objectKey: string;
      publicUrl: string;
      expiresAt: string;
      headers: Record<string, string>;
    }>();
    expect(body.objectKey).toMatch(new RegExp(`^garage-cover/${user.id}/`));
    expect(body.uploadUrl).toContain(body.objectKey);
    expect(body.publicUrl).toContain(body.objectKey);
    expect(typeof body.expiresAt).toBe('string');
  });

  it('rejects unknown content types', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/cover/upload',
      headers: { authorization: bearer(env, user.id) },
      payload: { contentType: 'image/gif', size: 1024 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects client-supplied kind override (server injects garage_cover)', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/cover/upload',
      headers: { authorization: bearer(env, user.id) },
      payload: { contentType: 'image/jpeg', size: 1024, kind: 'avatar' },
    });
    // Either accepted with garage_cover key (ignoring extra) OR strict 400.
    // Either way, the returned key MUST be garage-cover/.
    if (res.statusCode === 200) {
      const body = res.json<{ objectKey: string }>();
      expect(body.objectKey).toMatch(/^garage-cover\//);
    } else {
      expect(res.statusCode).toBe(400);
    }
  });

  it('rate-limits to 5/min/user — 6th call returns 429', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const token = bearer(env, user.id);
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/garage/cover/upload',
        headers: { authorization: token },
        payload: { contentType: 'image/jpeg', size: 1024 },
      });
      expect(res.statusCode).toBe(200);
    }
    const res6 = await app.inject({
      method: 'POST',
      url: '/me/garage/cover/upload',
      headers: { authorization: token },
      payload: { contentType: 'image/jpeg', size: 1024 },
    });
    expect(res6.statusCode).toBe(429);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/cover/upload',
      payload: { contentType: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /me/garage/cover', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sets the free default-door preset for free users', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: 'default-door' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { coverPreset: string | null } }>();
    expect(body.garage.coverPreset).toBe('default-door');
  });

  it('rejects premium presets for free users with 400', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: 'tokyo-wangan' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts premium presets for premium users', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: 'tokyo-wangan' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { coverPreset: string | null } }>();
    expect(body.garage.coverPreset).toBe('tokyo-wangan');
  });

  it('clears coverPreset with null', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: { coverPreset: 'default-door' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: null },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { coverPreset: string | null } }>();
    expect(body.garage.coverPreset).toBeNull();
  });

  it('rejects an unknown preset slug with 400', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts coverImageObjectKey scoped to the owner for premium users', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const key = `garage-cover/${user.id}/abc.jpg`;
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverImageObjectKey: key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { coverImageObjectKey: string | null } }>();
    expect(body.garage.coverImageObjectKey).toBe(key);
  });

  it('rejects coverImageObjectKey from free users with 400', async () => {
    const { user } = await createUser({ verified: true });
    const key = `garage-cover/${user.id}/abc.jpg`;
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverImageObjectKey: key },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a coverImageObjectKey outside garage-cover/<userId>/', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverImageObjectKey: 'cars/abc.jpg' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a coverImageObjectKey owned by a different user', async () => {
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    await grantPremium(b.id);
    const key = `garage-cover/${a.id}/abc.jpg`;
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, b.id) },
      payload: { coverImageObjectKey: key },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clears coverImageObjectKey with null', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    await prisma.garage.update({
      where: { userId: user.id },
      data: { coverImageObjectKey: `garage-cover/${user.id}/abc.jpg` },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverImageObjectKey: null },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { coverImageObjectKey: string | null } }>();
    expect(body.garage.coverImageObjectKey).toBeNull();
  });

  it('setting coverPreset also clears coverImageObjectKey (mutual exclusion)', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    await prisma.garage.update({
      where: { userId: user.id },
      data: { coverImageObjectKey: `garage-cover/${user.id}/abc.jpg` },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: 'tokyo-wangan' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      garage: { coverPreset: string | null; coverImageObjectKey: string | null };
    }>();
    expect(body.garage.coverPreset).toBe('tokyo-wangan');
    expect(body.garage.coverImageObjectKey).toBeNull();
  });

  it('setting coverImageObjectKey also clears coverPreset (mutual exclusion)', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    await prisma.garage.update({
      where: { userId: user.id },
      data: { coverPreset: 'tokyo-wangan' },
    });
    const env = loadEnv();
    const key = `garage-cover/${user.id}/abc.jpg`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverImageObjectKey: key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      garage: { coverPreset: string | null; coverImageObjectKey: string | null };
    }>();
    expect(body.garage.coverImageObjectKey).toBe(key);
    expect(body.garage.coverPreset).toBeNull();
  });

  it('rejects a body that mixes coverPreset and coverImageObjectKey', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        coverPreset: 'tokyo-wangan',
        coverImageObjectKey: `garage-cover/${user.id}/abc.jpg`,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes garage.cover_set audit on successful preset PATCH', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: 'default-door' },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: user.id, action: 'garage.cover_set' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('garage');
    const meta = audit?.metadata as { from: string | null; to: string | null } | null;
    expect(meta?.from).toBeNull();
    expect(meta?.to).toBe('default-door');
  });

  it('writes garage.cover_reset audit when preset PATCH clears the field', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: { coverPreset: 'default-door' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverPreset: null },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: user.id, action: 'garage.cover_reset' },
    });
    expect(audit).not.toBeNull();
    const meta = audit?.metadata as { from: string | null; to: string | null } | null;
    expect(meta?.from).toBe('default-door');
    expect(meta?.to).toBeNull();
  });

  it('writes garage.cover_set audit on successful coverImageObjectKey PATCH', async () => {
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const key = `garage-cover/${user.id}/abc.jpg`;
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: bearer(env, user.id) },
      payload: { coverImageObjectKey: key },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: user.id, action: 'garage.cover_set' },
    });
    expect(audit).not.toBeNull();
    const meta = audit?.metadata as { from: string | null; to: string | null } | null;
    expect(meta?.from).toBeNull();
    expect(meta?.to).toBe(key);
  });

  it('rate-limits PATCH to 5/min/user — 6th call returns 429', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const token = bearer(env, user.id);
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/me/garage/cover',
        headers: { authorization: token },
        payload: { coverPreset: 'default-door' },
      });
      expect(res.statusCode).toBe(200);
    }
    const res6 = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: { authorization: token },
      payload: { coverPreset: 'default-door' },
    });
    expect(res6.statusCode).toBe(429);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      payload: { coverPreset: 'default-door' },
    });
    expect(res.statusCode).toBe(401);
  });
});
