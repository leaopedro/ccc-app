import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag' },
      {
        code: 'CAR-003',
        category: 'carros',
        rarity: 'legendary',
        icon: 'curator',
        premiumExclusive: true,
      },
    ],
  });
};

describe('POST /admin/users/:id/garage/badges/:code/grant', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/anyone/garage/badges/EVT-001/grant',
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for non-admin role', async () => {
    const { user } = await createUser({ email: 'plain@jdm.test', verified: true, role: 'user' });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/garage/badges/EVT-001/grant`,
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('grants a non-premium badge to a free user', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'target@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/EVT-001/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ awarded: true, code: 'EVT-001' });

    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: target.id } });
    const earned = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: garage.id, badgeCode: 'EVT-001' },
    });
    expect(earned.sourceRef).toBe(`admin:${admin.id}`);

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { action: 'badge.award', actorId: admin.id },
    });
    expect(audit.entityType).toBe('garage');
    expect(audit.entityId).toBe(garage.id);
  });

  it('admin override grants a premium-exclusive badge to a free user', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'free-target@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/CAR-003/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(201);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: target.id } });
    const earned = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: garage.id, badgeCode: 'CAR-003' },
    });
    expect(earned.sourceRef).toBe(`admin:${admin.id}`);
  });

  it('409 already_earned on the second grant of the same code', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org3@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'dup-target@jdm.test',
      verified: true,
    });
    const env = loadEnv();
    const url = `/admin/users/${target.id}/garage/badges/EVT-001/grant`;
    const headers = { authorization: bearer(env, admin.id, 'organizer') };

    const r1 = await app.inject({ method: 'POST', url, headers });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.inject({ method: 'POST', url, headers });
    expect(r2.statusCode).toBe(409);
    expect(r2.json()).toEqual({ error: 'already_earned' });
  });

  it('409 gamification_disabled when the killswitch is off', async () => {
    await seedCatalog();
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user: admin } = await createUser({
      email: 'org4@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'kill-target@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/EVT-001/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'gamification_disabled' });
  });

  it('400 invalid_code for a malformed badge code', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org5@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'bad-target@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/garbage/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
  });
});
