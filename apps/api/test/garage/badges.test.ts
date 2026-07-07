import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { invalidateBadgesCatalogCache } from '../../src/routes/badges-catalog.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// Test seed for the badge catalog. Mirrors the production seed (12 entries
// across 4 categories × 3 rarities) but flips one CAR + one JDM entry to
// `premiumExclusive: true` so locked_premium + public-lapse-masking specs
// have something to assert against. resetDatabase() drops the badge tables
// between tests, so each block re-seeds explicitly.
const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag' },
      { code: 'EVT-002', category: 'eventos', rarity: 'rare', icon: 'streak' },
      { code: 'EVT-003', category: 'eventos', rarity: 'legendary', icon: 'medal' },
      { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car' },
      { code: 'CAR-002', category: 'carros', rarity: 'rare', icon: 'garageFull' },
      {
        code: 'CAR-003',
        category: 'carros',
        rarity: 'legendary',
        icon: 'curator',
        premiumExclusive: true,
      },
      { code: 'COM-001', category: 'comunidade', rarity: 'common', icon: 'post' },
      { code: 'COM-002', category: 'comunidade', rarity: 'rare', icon: 'chat' },
      { code: 'COM-003', category: 'comunidade', rarity: 'legendary', icon: 'fire' },
      { code: 'JDM-001', category: 'jdm', rarity: 'common', icon: 'pin' },
      { code: 'JDM-002', category: 'jdm', rarity: 'rare', icon: 'flagCheck' },
      {
        code: 'JDM-003',
        category: 'jdm',
        rarity: 'legendary',
        icon: 'founder',
        premiumExclusive: true,
      },
    ],
  });
};

const grantPremium = async (userId: string, premiumUntil: Date | null = null) =>
  prisma.garage.update({
    where: { userId },
    data: { premiumTier: 'gold', premiumUntil },
  });

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const earnBadge = async (userId: string, code: string, pinned = false): Promise<void> => {
  await prisma.garageBadge.create({
    data: {
      garageId: await garageId(userId),
      badgeCode: code,
      pinned,
      pinnedAt: pinned ? new Date() : null,
    },
  });
};

describe('GET /badges/catalog', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateBadgesCatalogCache();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the full catalog with enabled: true when killswitch is on (no auth)', async () => {
    await seedCatalog();
    const res = await app.inject({ method: 'GET', url: '/badges/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      enabled: boolean;
      catalog: { code: string; premiumExclusive: boolean }[];
    }>();
    expect(body.enabled).toBe(true);
    expect(body.catalog).toHaveLength(12);
    const car003 = body.catalog.find((b) => b.code === 'CAR-003');
    expect(car003?.premiumExclusive).toBe(true);
  });

  it('returns enabled: false + empty catalog when killswitch is off', async () => {
    await seedCatalog();
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const res = await app.inject({ method: 'GET', url: '/badges/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, catalog: [] });
  });
});

describe('GET /me/garage/badges', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateBadgesCatalogCache();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns full catalog with every state locked / locked_premium for a fresh free account', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      enabled: boolean;
      catalog: { code: string; premiumExclusive: boolean }[];
      badges: { code: string; state: string }[];
    }>();
    expect(body.enabled).toBe(true);
    expect(body.catalog).toHaveLength(12);
    expect(body.badges).toHaveLength(12);
    const car003 = body.badges.find((b) => b.code === 'CAR-003');
    expect(car003?.state).toBe('locked_premium');
    const jdm003 = body.badges.find((b) => b.code === 'JDM-003');
    expect(jdm003?.state).toBe('locked_premium');
    const evt001 = body.badges.find((b) => b.code === 'EVT-001');
    expect(evt001?.state).toBe('locked');
  });

  it('classifies premium-exclusive badge as locked (not locked_premium) for premium-active account', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await grantPremium(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ badges: { code: string; state: string }[] }>();
    const car003 = body.badges.find((b) => b.code === 'CAR-003');
    expect(car003?.state).toBe('locked');
  });

  it('returns earned + pinned state for badges the user owns', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await earnBadge(user.id, 'EVT-001', true);
    await earnBadge(user.id, 'CAR-001', false);
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      badges: { code: string; state: string; pinned?: boolean; earnedAt?: string }[];
    }>();
    const evt = body.badges.find((b) => b.code === 'EVT-001');
    expect(evt?.state).toBe('earned');
    expect(evt?.pinned).toBe(true);
    const car = body.badges.find((b) => b.code === 'CAR-001');
    expect(car?.state).toBe('earned');
    expect(car?.pinned).toBe(false);
  });

  it('returns enabled: false + empty arrays when killswitch is off', async () => {
    await seedCatalog();
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, catalog: [], badges: [] });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/garage/badges' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /me/garage/badges/:code/pin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateBadgesCatalogCache();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('pins an earned badge and writes a badge.pin audit row', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await earnBadge(user.id, 'EVT-001', false);
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/badges/EVT-001/pin',
      headers: { authorization: bearer(env, user.id) },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      badge: { code: string; pinned: boolean; pinnedAt: string | null };
    }>();
    expect(body.badge.code).toBe('EVT-001');
    expect(body.badge.pinned).toBe(true);
    expect(body.badge.pinnedAt).not.toBeNull();

    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: user.id, action: 'badge.pin' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('garage');
    const meta = audit?.metadata as { badgeCode: string };
    expect(meta.badgeCode).toBe('EVT-001');
  });

  it('unpins a pinned badge and writes a badge.unpin audit row, clearing pinnedAt', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await earnBadge(user.id, 'EVT-001', true);
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/badges/EVT-001/pin',
      headers: { authorization: bearer(env, user.id) },
      payload: { pinned: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ badge: { pinned: boolean; pinnedAt: string | null } }>();
    expect(body.badge.pinned).toBe(false);
    expect(body.badge.pinnedAt).toBeNull();

    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: user.id, action: 'badge.unpin' },
    });
    expect(audit).not.toBeNull();
  });

  it('returns 409 pin_limit when the 4th pin attempt exceeds the cap', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await earnBadge(user.id, 'EVT-001', false);
    await earnBadge(user.id, 'EVT-002', false);
    await earnBadge(user.id, 'EVT-003', false);
    await earnBadge(user.id, 'CAR-001', false);
    const env = loadEnv();
    const token = bearer(env, user.id);
    const pinReq = (code: string) =>
      app.inject({
        method: 'PATCH',
        url: `/me/garage/badges/${code}/pin`,
        headers: { authorization: token },
        payload: { pinned: true },
      });
    expect((await pinReq('EVT-001')).statusCode).toBe(200);
    expect((await pinReq('EVT-002')).statusCode).toBe(200);
    expect((await pinReq('EVT-003')).statusCode).toBe(200);
    const fourth = await pinReq('CAR-001');
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json<{ error: string }>().error).toBe('pin_limit');

    // 4th badge must remain unpinned.
    const row = await prisma.garageBadge.findFirstOrThrow({
      where: { badgeCode: 'CAR-001' },
    });
    expect(row.pinned).toBe(false);
  });

  it('re-pinning an already-pinned badge is a no-op for the cap (no 409)', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await earnBadge(user.id, 'EVT-001', true);
    await earnBadge(user.id, 'EVT-002', true);
    await earnBadge(user.id, 'EVT-003', true);
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/badges/EVT-001/pin',
      headers: { authorization: bearer(env, user.id) },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 not_found when the user has not earned the badge', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/badges/EVT-001/pin',
      headers: { authorization: bearer(env, user.id) },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('not_found');
  });

  it('returns 404 not_found for an invalid code shape', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/badges/bogus-id/pin',
      headers: { authorization: bearer(env, user.id) },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 gamification_disabled when the killswitch is off', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await earnBadge(user.id, 'EVT-001', false);
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/badges/EVT-001/pin',
      headers: { authorization: bearer(env, user.id) },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('gamification_disabled');
  });
});

describe('public garage payload — pinned badges', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateBadgesCatalogCache();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const makePublicGarage = async (
    userId: string,
    slug: string,
    opts: { premium?: boolean; premiumUntil?: Date | null } = {},
  ) => {
    await prisma.garage.update({
      where: { userId },
      data: {
        slug,
        isPublic: true,
        ...(opts.premium ? { premiumTier: 'gold' } : {}),
        ...(opts.premiumUntil !== undefined ? { premiumUntil: opts.premiumUntil } : {}),
      },
    });
  };

  it('public payload returns pinned-only badges ordered pinnedAt DESC', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await makePublicGarage(user.id, 'pin-order');
    // Earn three, pin two with deterministic timestamps.
    const g = await garageId(user.id);
    const t1 = new Date('2026-05-01T10:00:00Z');
    const t2 = new Date('2026-05-02T10:00:00Z');
    await prisma.garageBadge.createMany({
      data: [
        { garageId: g, badgeCode: 'EVT-001', pinned: true, pinnedAt: t1, earnedAt: t1 },
        { garageId: g, badgeCode: 'EVT-002', pinned: true, pinnedAt: t2, earnedAt: t2 },
        { garageId: g, badgeCode: 'EVT-003', pinned: false, pinnedAt: null },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/g/pin-order' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { badges: { code: string }[] } }>();
    expect(body.garage.badges.map((b) => b.code)).toEqual(['EVT-002', 'EVT-001']);
  });

  it('hides premium-exclusive earned-and-pinned badges on public after premium lapse', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    // Premium-active state during the earn + pin.
    await makePublicGarage(user.id, 'lapsed', { premium: true, premiumUntil: null });
    const g = await garageId(user.id);
    await prisma.garageBadge.create({
      data: { garageId: g, badgeCode: 'CAR-003', pinned: true, pinnedAt: new Date() },
    });
    await prisma.garageBadge.create({
      data: { garageId: g, badgeCode: 'EVT-001', pinned: true, pinnedAt: new Date() },
    });

    // First fetch — premium-active, both badges visible.
    const before = await app.inject({ method: 'GET', url: '/g/lapsed' });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json<{ garage: { badges: { code: string }[] } }>();
    expect(beforeBody.garage.badges.map((b) => b.code).sort()).toEqual(['CAR-003', 'EVT-001']);

    // Flip premiumUntil to the past — premium is now inactive.
    await prisma.garage.update({
      where: { userId: user.id },
      data: { premiumUntil: new Date('2024-01-01T00:00:00Z') },
    });
    const after = await app.inject({ method: 'GET', url: '/g/lapsed' });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json<{ garage: { badges: { code: string }[] } }>();
    expect(afterBody.garage.badges.map((b) => b.code)).toEqual(['EVT-001']);
  });

  it('public payload reports gamification.enabled=false + empty badges when killswitch is off', async () => {
    await seedCatalog();
    const { user } = await createUser({ verified: true });
    await makePublicGarage(user.id, 'killswitch-off');
    const g = await garageId(user.id);
    await prisma.garageBadge.create({
      data: { garageId: g, badgeCode: 'EVT-001', pinned: true, pinnedAt: new Date() },
    });
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const res = await app.inject({ method: 'GET', url: '/g/killswitch-off' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ garage: { gamification: { enabled: boolean }; badges: unknown[] } }>();
    expect(body.garage.gamification.enabled).toBe(false);
    expect(body.garage.badges).toEqual([]);
  });
});

describe('badges catalog cache invalidation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateBadgesCatalogCache();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('admin PUT gamificationEnabled toggle invalidates the catalog cache', async () => {
    await seedCatalog();
    // Warm the cache with the killswitch ON (default true).
    const warm = await app.inject({ method: 'GET', url: '/badges/catalog' });
    expect(warm.statusCode).toBe(200);
    expect(warm.json<{ enabled: boolean }>().enabled).toBe(true);

    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const env = loadEnv();
    const toggle = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(env, user.id, 'organizer') },
      payload: { gamificationEnabled: false },
    });
    expect(toggle.statusCode).toBe(200);

    const cold = await app.inject({ method: 'GET', url: '/badges/catalog' });
    expect(cold.json()).toEqual({ enabled: false, catalog: [] });
  });

  it('admin PUT gamificationEnabled re-enable invalidates the catalog cache', async () => {
    await seedCatalog();
    // Start with the killswitch OFF + cache warmed in the empty shape.
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const warm = await app.inject({ method: 'GET', url: '/badges/catalog' });
    expect(warm.json()).toEqual({ enabled: false, catalog: [] });

    const { user } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const env = loadEnv();
    const toggle = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(env, user.id, 'organizer') },
      payload: { gamificationEnabled: true },
    });
    expect(toggle.statusCode).toBe(200);

    const cold = await app.inject({ method: 'GET', url: '/badges/catalog' });
    const body = cold.json<{ enabled: boolean; catalog: unknown[] }>();
    expect(body.enabled).toBe(true);
    expect(body.catalog.length).toBeGreaterThan(0);
  });
});
