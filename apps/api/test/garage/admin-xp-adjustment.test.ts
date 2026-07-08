import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as adminAuditModule from '../../src/services/admin-audit.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

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

const post = (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  adminId: string,
  role: 'admin' | 'organizer',
  targetId: string,
  body: { delta: number; reason: string },
) =>
  app.inject({
    method: 'POST',
    url: `/admin/users/${targetId}/garage/xp-adjustment`,
    headers: { authorization: bearer(env, adminId, role) },
    payload: body,
  });

describe('POST /admin/users/:id/garage/xp-adjustment (chunk 35)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('positive delta — writes XpEvent + AdminAudit + returns updated xp (audit inside tx)', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 50,
      reason: 'Compensação por bug no checkin',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ xp: 50 });

    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: target.id } });
    expect(garage.xp).toBe(50);

    const events = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('expected one xp event');
    expect(event.reason).toBe('admin_adjustment');
    expect(event.delta).toBe(50);
    expect(event.sourceRef).toMatch(new RegExp(`^admin:${admin.id}:[0-9a-f-]{36}$`));

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { action: 'xp.adjustment', actorId: admin.id },
    });
    expect(audit.entityType).toBe('garage');
    expect(audit.entityId).toBe(garage.id);
    const metadata = audit.metadata as Record<string, unknown>;
    expect(metadata.delta).toBe(50);
    expect(metadata.reason).toBe('Compensação por bug no checkin');
    expect(metadata.targetUserId).toBe(target.id);
    expect(metadata.sourceRef).toBe(event.sourceRef);
    expect(audit.createdAt.getTime()).toBeGreaterThanOrEqual(event.createdAt.getTime());
  });

  it('401 without auth header', async () => {
    const { target } = await seedAdminAndTarget();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/xp-adjustment`,
      payload: { delta: 10, reason: 'no auth' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for non-admin role (organizer denied)', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();
    const res = await post(app, env, admin.id, 'organizer', target.id, {
      delta: 10,
      reason: 'organizer attempt',
    });
    expect(res.statusCode).toBe(403);
  });

  it('negative delta — single signed XpEvent row, decrements Garage.xp (§C8)', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const r1 = await post(app, env, admin.id, 'admin', target.id, {
      delta: 100,
      reason: 'seed amount',
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await post(app, env, admin.id, 'admin', target.id, {
      delta: -30,
      reason: 'Reversão de fraude detectada',
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ xp: 70 });

    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: target.id } });
    expect(garage.xp).toBe(70);

    const events = await prisma.xpEvent.findMany({
      where: { garageId: garage.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    const second = events[1];
    if (!second) throw new Error('expected second xp event');
    expect(second.delta).toBe(-30);
    expect(second.reason).toBe('admin_adjustment');
  });

  it('400 invalid_delta when delta = 0', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 0,
      reason: 'noop attempt',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_delta' });
    expect(await prisma.xpEvent.count()).toBe(0);
  });

  it('422 invalid_body when reason too short', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 10,
      reason: 'ab',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'invalid_body' });
  });

  it('422 invalid_body when delta out of range', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 99_999,
      reason: 'too big',
    });
    expect(res.statusCode).toBe(422);
  });

  it('409 gamification_disabled when killswitch off (§"Killswitch" L510)', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 25,
      reason: 'should be blocked',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'gamification_disabled' });
    expect(await prisma.xpEvent.count()).toBe(0);
    expect(await prisma.adminAudit.count({ where: { action: 'xp.adjustment' } })).toBe(0);
  });

  it('does NOT create a garage for a target user when killswitch is off', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    // seedAdminAndTarget's signup pipeline auto-creates a Garage. Wipe it
    // so we can verify the route's killswitch-first ordering: the route
    // must short-circuit BEFORE calling ensureGarageForUserId, which would
    // otherwise re-create the garage even when gamification is off.
    await prisma.garage.deleteMany({ where: { userId: target.id } });

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 25,
      reason: 'should be blocked',
    });
    expect(res.statusCode).toBe(409);
    expect(await prisma.garage.count({ where: { userId: target.id } })).toBe(0);
  });

  it('404 NotFound when target user does not exist', async () => {
    const { admin } = await seedAdminAndTarget();
    const env = loadEnv();

    const res = await post(app, env, admin.id, 'admin', 'nonexistent-user-id', {
      delta: 10,
      reason: 'missing target',
    });
    expect(res.statusCode).toBe(404);
  });

  it('UUID sourceRef ensures no collision on repeat support calls (§C1 + §C7)', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    const payload = { delta: 5, reason: 'same reason' };
    const r1 = await post(app, env, admin.id, 'admin', target.id, payload);
    const r2 = await post(app, env, admin.id, 'admin', target.id, payload);
    const r3 = await post(app, env, admin.id, 'admin', target.id, payload);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(200);
    expect(r3.json()).toEqual({ xp: 15 });

    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: target.id } });
    const events = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.sourceRef)).size).toBe(3);
    for (const e of events) {
      expect(e.sourceRef).toMatch(new RegExp(`^admin:${admin.id}:[0-9a-f-]{36}$`));
    }
  });

  it('429 when rate-limit exceeded (30/min/admin inner bucket)', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    for (let i = 0; i < 30; i++) {
      const res = await post(app, env, admin.id, 'admin', target.id, {
        delta: 1,
        reason: `iter ${i}`,
      });
      expect(res.statusCode).toBe(200);
    }

    const res31 = await post(app, env, admin.id, 'admin', target.id, {
      delta: 1,
      reason: 'over limit',
    });
    expect(res31.statusCode).toBe(429);
  });

  it('rate-limit buckets are per-admin, not per-IP (§C7 isolation)', async () => {
    // Seed two distinct admins. fastify.inject defaults their IP to 127.0.0.1
    // so any IP-keyed bucket would conflict. Per-admin keying means admin B
    // still has its full 30/min budget after admin A burns theirs.
    const stamp = `${Date.now()}-${Math.random()}`;
    const { user: adminA } = await createUser({
      email: `admin-a-${stamp}@jdm.test`,
      verified: true,
      role: 'admin',
    });
    const { user: adminB } = await createUser({
      email: `admin-b-${stamp}@jdm.test`,
      verified: true,
      role: 'admin',
    });
    const { user: target } = await createUser({
      email: `target-shared-ip-${stamp}@jdm.test`,
      verified: true,
    });
    const env = loadEnv();

    for (let i = 0; i < 30; i++) {
      const res = await post(app, env, adminA.id, 'admin', target.id, {
        delta: 1,
        reason: `A iter ${i}`,
      });
      expect(res.statusCode).toBe(200);
    }
    const aOver = await post(app, env, adminA.id, 'admin', target.id, {
      delta: 1,
      reason: 'A over',
    });
    expect(aOver.statusCode).toBe(429);

    // Same IP, different admin sub → must NOT inherit admin A's exhausted
    // bucket. The prior outer-block omission of hook: 'preHandler' caused
    // the keyGenerator to run before auth populated request.user, falling
    // through to admin-xp-adj-ip:127.0.0.1 — admin B would have hit 429 too.
    const bFirst = await post(app, env, adminB.id, 'admin', target.id, {
      delta: 1,
      reason: 'B first',
    });
    expect(bFirst.statusCode).toBe(200);
  });

  it('AdminAudit failure rolls back XpEvent + Garage.xp (atomicity inside tx)', async () => {
    const { admin, target } = await seedAdminAndTarget();
    const env = loadEnv();

    vi.spyOn(adminAuditModule, 'recordAudit').mockRejectedValueOnce(new Error('audit-down'));

    const res = await post(app, env, admin.id, 'admin', target.id, {
      delta: 75,
      reason: 'should fully roll back',
    });
    expect(res.statusCode).toBe(500);

    expect(await prisma.xpEvent.count({ where: { reason: 'admin_adjustment' } })).toBe(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: target.id } });
    expect(garage.xp).toBe(0);
    expect(await prisma.adminAudit.count({ where: { action: 'xp.adjustment' } })).toBe(0);
  });
});
