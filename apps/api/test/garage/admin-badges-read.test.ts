import { prisma } from '@ccc/db';
import { garageBadgesOwnerResponseSchema } from '@ccc/shared/badges';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// Same 12-entry shape the owner-route specs use, with one CAR + one CCC entry
// flipped premium-exclusive so the locked_premium branch has something to hit.
const seedCatalog = async () => {
  const rows = [
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
    { code: 'CCC-001', category: 'ccc', rarity: 'common', icon: 'pin' },
    { code: 'CCC-002', category: 'ccc', rarity: 'rare', icon: 'flagCheck' },
    {
      code: 'CCC-003',
      category: 'ccc',
      rarity: 'legendary',
      icon: 'founder',
      premiumExclusive: true,
    },
  ] as const;
  await prisma.badge.createMany({
    data: rows.map((r) => ({
      ...r,
      title: `Conquista ${r.code}`,
      description: `Descrição de ${r.code}`,
    })),
  });
};

const seedAdminAndTarget = async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { user: admin } = await createUser({
    email: `admin-${stamp}@jdm.test`,
    verified: true,
    role: 'admin',
  });
  const { user: target } = await createUser({
    email: `target-${stamp}@jdm.test`,
    verified: true,
  });
  return { admin, target };
};

const earnBadge = async (userId: string, code: string, pinned = false): Promise<void> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  await prisma.garageBadge.create({
    data: {
      garageId: g.id,
      badgeCode: code,
      pinned,
      pinnedAt: pinned ? new Date() : null,
    },
  });
};

const get = (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  actorId: string,
  role: 'admin' | 'organizer' | 'staff',
  targetId: string,
) =>
  app.inject({
    method: 'GET',
    url: `/admin/users/${targetId}/garage/badges`,
    headers: { authorization: bearer(env, actorId, role) },
  });

describe('GET /admin/users/:id/garage/badges', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports UNPINNED earned badges as earned — the gap the public-payload fallback had', async () => {
    await seedCatalog();
    const { admin, target } = await seedAdminAndTarget();
    await earnBadge(target.id, 'EVT-001', true);
    await earnBadge(target.id, 'CAR-001', false);
    const env = loadEnv();

    const res = await get(app, env, admin.id, 'admin', target.id);

    expect(res.statusCode).toBe(200);
    const body = garageBadgesOwnerResponseSchema.parse(res.json());
    expect(body.enabled).toBe(true);
    expect(body.catalog).toHaveLength(12);
    const earned = body.badges
      .filter((b) => b.state === 'earned')
      .map((b) => b.code)
      .sort();
    // The old fallback read pinned-only, so CAR-001 was invisible here.
    expect(earned).toEqual(['CAR-001', 'EVT-001']);
  });

  it('still reports earned badges when the target garage is private', async () => {
    await seedCatalog();
    const { admin, target } = await seedAdminAndTarget();
    await prisma.garage.update({ where: { userId: target.id }, data: { isPublic: false } });
    await earnBadge(target.id, 'EVT-002', true);
    const env = loadEnv();

    const res = await get(app, env, admin.id, 'admin', target.id);

    expect(res.statusCode).toBe(200);
    const body = garageBadgesOwnerResponseSchema.parse(res.json());
    // The old fallback hit GET /g/:slug, which 404s on a private garage and
    // left the panel with an empty earned list.
    expect(body.badges.find((b) => b.code === 'EVT-002')?.state).toBe('earned');
  });

  it('classifies premium-exclusive entries as locked_premium for a free target', async () => {
    await seedCatalog();
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await get(app, env, admin.id, 'admin', target.id);

    expect(res.statusCode).toBe(200);
    const body = garageBadgesOwnerResponseSchema.parse(res.json());
    expect(body.badges.find((b) => b.code === 'CAR-003')?.state).toBe('locked_premium');
    expect(body.badges.find((b) => b.code === 'EVT-001')?.state).toBe('locked');
  });

  it('404 for an unknown user id', async () => {
    await seedCatalog();
    const { admin } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await get(app, env, admin.id, 'admin', 'nope-not-a-user');

    expect(res.statusCode).toBe(404);
  });

  it('returns the empty enabled:false shape when the killswitch is off', async () => {
    await seedCatalog();
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { admin, target } = await seedAdminAndTarget();
    await earnBadge(target.id, 'EVT-001', true);
    const env = loadEnv();

    const res = await get(app, env, admin.id, 'admin', target.id);

    expect(res.statusCode).toBe(200);
    const body = garageBadgesOwnerResponseSchema.parse(res.json());
    expect(body).toEqual({ enabled: false, catalog: [], badges: [] });
  });

  it('organizer may read; staff is rejected by the surrounding role guard', async () => {
    await seedCatalog();
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const asOrganizer = await get(app, env, admin.id, 'organizer', target.id);
    expect(asOrganizer.statusCode).toBe(200);

    const asStaff = await get(app, env, admin.id, 'staff', target.id);
    expect(asStaff.statusCode).toBe(403);
  });
});
