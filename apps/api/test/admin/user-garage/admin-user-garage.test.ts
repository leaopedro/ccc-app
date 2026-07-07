import { prisma } from '@jdm/db';
import { adminGarageReadSchema, adminGarageSummarySchema } from '@jdm/shared/admin-garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('GET /admin/users/:id/garage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users/x/garage' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/garage`,
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 for unknown target user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/missing/garage',
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns garage summary + spots for a user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 't@jdm.test',
      name: 'Target',
      verified: true,
    });
    await prisma.garageSpot.create({
      data: { userId: target.id, source: 'admin_grant', carId: null },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageReadSchema.parse(res.json());
    expect(body.user.id).toBe(target.id);
    expect(body.garage.userId).toBe(target.id);
    expect(body.garage.premiumTier).toBeNull();
    expect(body.garage.isPremiumActive).toBe(false);
    expect(body.spots).toHaveLength(1);
    expect(body.spots[0]!.source).toBe('admin_grant');
  });

  it('recovers when the predicted default slug is squatted by another user (slug race)', async () => {
    // Simulates the SELECT→INSERT race inside ensureGarageForUserId: another
    // user already holds the slug findFreeGarageSlug() would return. Round-1
    // recovery only covered the userId race (same user) and bubbled this case
    // as a 500. With the bounded retry, the helper must observe the collider
    // on the second pass and pick a -2 suffix.
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });

    // Fresh user with NO Garage row, pinned to a hand-rolled id so its
    // 8-char prefix is guaranteed not to collide with other test users
    // (cuids generated in the same ms tend to share long prefixes). Mirrors
    // the pre-signup-hook situation ensureGarageForUserId is defensive
    // against.
    const fresh = await prisma.user.create({
      data: {
        id: 'ckslugrz0000000000000001',
        email: 'fresh@jdm.test',
        name: 'Fresh',
        passwordHash: 'x',
      },
    });
    const predicted = `user-${fresh.id.slice(0, 8).toLowerCase()}`;
    // Squatter user + Garage are minted directly (not via createUser) so we
    // control the squatter's Garage.slug exactly: it must equal `predicted`
    // when ensureGarageForUserId runs against `fresh`.
    const squatter = await prisma.user.create({
      data: {
        id: 'cksquatter000000000000001',
        email: 'sq@jdm.test',
        name: 'Sq',
        passwordHash: 'x',
      },
    });
    await prisma.garage.create({
      data: {
        userId: squatter.id,
        name: 'Garagem',
        slug: predicted,
        isPublic: false,
      },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${fresh.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageReadSchema.parse(res.json());
    // Slug must be the -2 suffix bump (or higher), never the squatted base.
    expect(body.garage.slug).not.toBe(predicted);
    expect(body.garage.slug.startsWith(`${predicted}-`)).toBe(true);
    expect(body.garage.userId).toBe(fresh.id);
  });

  it('materializes default_free spots up to the bounded cap before reading', async () => {
    // Regression: prior to reconcile-before-read, a user with no
    // pre-materialized default_free rows (e.g. signup that didn't reconcile)
    // would show 0 free spots on a bounded cap even though they're entitled
    // to N. Reconcile in the GET handler closes that gap.
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      update: { defaultFreeGarageSpots: 2 },
      create: { id: 'general_default', defaultFreeGarageSpots: 2 },
    });
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    // No default_free spots pre-materialized.
    expect(
      await prisma.garageSpot.count({ where: { userId: target.id, source: 'default_free' } }),
    ).toBe(0);

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageReadSchema.parse(res.json());
    expect(body.spots.filter((s) => s.source === 'default_free')).toHaveLength(2);
  });
});

describe('POST /admin/users/:id/garage/premium', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('grants premium and writes garage.premium_grant audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const until = '2030-01-01T00:00:00.000Z';

    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/premium`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { tier: 'gold', premiumUntil: until },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.premiumTier).toBe('gold');
    expect(body.premiumUntil).toBe(until);
    expect(body.isPremiumActive).toBe(true);

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('garage.premium_grant');
    expect(audits[0]!.entityType).toBe('garage');
    expect(audits[0]!.metadata).toMatchObject({
      userId: target.id,
      newTier: 'gold',
      newPremiumUntil: until,
    });
  });

  it('revokes premium and writes garage.premium_revoke audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    await prisma.garage.update({
      where: { userId: target.id },
      data: { premiumTier: 'bronze', premiumUntil: new Date('2030-01-01T00:00:00Z') },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/premium`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { tier: null, premiumUntil: null },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.premiumTier).toBeNull();
    expect(body.premiumUntil).toBeNull();
    expect(body.isPremiumActive).toBe(false);

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits.map((a) => a.action)).toContain('garage.premium_revoke');
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/garage/premium`,
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { tier: 'bronze', premiumUntil: null },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects mixed-state payload (tier=null with premiumUntil set) as 400', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/premium`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { tier: null, premiumUntil: '2030-01-01T00:00:00Z' },
    });
    expect(res.statusCode).toBe(400);

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits.map((a) => a.action)).not.toContain('garage.premium_revoke');
  });
});

describe('PATCH /admin/users/:id/garage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('overrides slug with chars that user-side regex would reject', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });

    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { slug: 'Admin-Override-99' },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.slug).toBe('Admin-Override-99');

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits.map((a) => a.action)).toContain('garage.slug_override');
  });

  it('rejects reserved slug with 400', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { slug: 'admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('reserved_slug');
  });

  it('returns 409 when slug collides with an existing garage', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    await prisma.garage.update({ where: { userId: a.id }, data: { slug: 'shared-slug' } });

    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${b.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { slug: 'shared-slug' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('slug_taken');
  });

  it('updates non-slug fields and emits garage.update audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/garage`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { name: 'Garagem do Suporte', description: 'forçada', isPublic: false },
    });
    expect(res.statusCode).toBe(200);
    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits.map((a) => a.action)).toContain('garage.update');
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}/garage`,
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /admin/users/:id/garage/spots', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('grants an admin_grant spot and writes audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });

    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/spots`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; source: string; carId: string | null }>();
    expect(body.source).toBe('admin_grant');
    expect(body.carId).toBeNull();

    const spot = await prisma.garageSpot.findUnique({ where: { id: body.id } });
    expect(spot?.userId).toBe(target.id);
    expect(spot?.source).toBe('admin_grant');

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits.map((a) => a.action)).toContain('garage.spot_grant');
    const grant = audits.find((a) => a.action === 'garage.spot_grant')!;
    expect(grant.entityType).toBe('garage_spot');
    expect(grant.entityId).toBe(body.id);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/garage/spots`,
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /admin/users/:id/garage/spots/:spotId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('revokes an admin_grant spot and writes audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const spot = await prisma.garageSpot.create({
      data: { userId: target.id, source: 'admin_grant', carId: null },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/garage/spots/${spot.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { reason: 'manual_cleanup' },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.garageSpot.findUnique({ where: { id: spot.id } })).toBeNull();

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    const revoke = audits.find((a) => a.action === 'garage.spot_revoke')!;
    expect(revoke.entityType).toBe('garage_spot');
    expect(revoke.entityId).toBe(spot.id);
    expect(revoke.metadata).toMatchObject({
      userId: target.id,
      source: 'admin_grant',
      reason: 'manual_cleanup',
    });
  });

  it('revokes a purchase spot with manual_refund reason', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const spot = await prisma.garageSpot.create({
      data: {
        userId: target.id,
        source: 'purchase',
        carId: null,
        sourceOrderItemId: 'oi_42',
      },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/garage/spots/${spot.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
      payload: { reason: 'manual_refund' },
    });
    expect(res.statusCode).toBe(204);
    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    const revoke = audits.find((a) => a.action === 'garage.spot_revoke')!;
    expect(revoke.metadata).toMatchObject({
      source: 'purchase',
      sourceOrderItemId: 'oi_42',
      reason: 'manual_refund',
    });
  });

  it('rejects revoking a default_free spot with 400', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const spot = await prisma.garageSpot.create({
      data: { userId: target.id, source: 'default_free', carId: null },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/garage/spots/${spot.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.garageSpot.findUnique({ where: { id: spot.id } })).not.toBeNull();
  });

  it('rejects revoking a filled spot with 409', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: {
        userId: target.id,
        make: 'Honda',
        model: 'Civic',
        year: 2000,
        nickname: `nick-${target.id.slice(0, 6)}`,
      },
    });
    const spot = await prisma.garageSpot.create({
      data: { userId: target.id, source: 'admin_grant', carId: car.id },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/garage/spots/${spot.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
  });

  it('404 when spot belongs to another user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    const spot = await prisma.garageSpot.create({
      data: { userId: a.id, source: 'admin_grant', carId: null },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${b.id}/garage/spots/${spot.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const spot = await prisma.garageSpot.create({
      data: { userId: user.id, source: 'admin_grant', carId: null },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${user.id}/garage/spots/${spot.id}`,
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });
});
