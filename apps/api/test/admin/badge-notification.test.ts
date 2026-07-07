import { prisma } from '@jdm/db';
import {
  BADGE_AWARDED_NOTIFICATION_KIND,
  BADGE_AWARDED_NOTIFICATION_TITLE,
  badgeAwardedDedupeKey,
  badgeTitlePtBr,
} from '@jdm/shared/badges-copy';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { awardBadge } from '../../src/services/garage/awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// Cover the chunk 22 contract: in-app notification fires from the admin
// manual-grant path only. Auto-award write-path hooks must NOT mint a
// Notification row. The dedupeKey is the single idempotency knob — a
// re-grant after un-grant must not double-notify.

const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag' },
      { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car' },
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

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('badge notification — admin manual grant', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('admin grant fires a notification with the canonical shape', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org-notify@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'target-notify@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/EVT-001/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(201);

    const inbox = await prisma.notification.findMany({
      where: { userId: target.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toHaveLength(1);
    const row = inbox[0]!;
    expect(row.title).toBe(BADGE_AWARDED_NOTIFICATION_TITLE);
    expect(row.body).toBe(badgeTitlePtBr('EVT-001'));
    expect(row.dedupeKey).toBe(badgeAwardedDedupeKey('EVT-001', target.id));
    expect(row.data).toEqual({ kind: 'badge_awarded', code: 'EVT-001' });
    // Push deferred to Phase 2D — the inbox row must NOT have sentAt set.
    expect(row.sentAt).toBeNull();
    expect(row.readAt).toBeNull();
  });

  it('admin grant of a premium-exclusive badge to a free user still notifies', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org-notify-prem@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'free-notify@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/CAR-003/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(201);

    const inbox = await prisma.notification.findMany({
      where: { userId: target.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.body).toBe(badgeTitlePtBr('CAR-003'));
  });

  it('auto-award (write-path hook) does NOT mint a notification', async () => {
    // POST /me/cars triggers CAR-001 via the awarder without notifyOnGrant.
    // The badge MUST land, but no inbox row should appear.
    await seedCatalog();
    const { user } = await createUser({ email: 'no-notify@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        make: 'Toyota',
        model: 'Supra',
        year: 1998,
        nickname: 'silent supra',
        modifications: [],
      },
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageId(user.id);
    const earned = await prisma.garageBadge.findFirst({
      where: { garageId: gid, badgeCode: 'CAR-001' },
    });
    expect(earned).not.toBeNull();

    const inbox = await prisma.notification.count({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toBe(0);
  });

  it('dedupeKey is idempotent — re-grant after un-grant does not double-notify', async () => {
    await seedCatalog();
    const { user: admin } = await createUser({
      email: 'org-dedupe@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'dedupe-target@jdm.test',
      verified: true,
    });
    const env = loadEnv();
    const url = `/admin/users/${target.id}/garage/badges/EVT-001/grant`;
    const headers = { authorization: bearer(env, admin.id, 'organizer') };

    // First grant — Notification + GarageBadge land.
    const r1 = await app.inject({ method: 'POST', url, headers });
    expect(r1.statusCode).toBe(201);

    // Simulate an admin un-grant by removing the GarageBadge row directly.
    // The dedupeKey notification persists in the inbox (we don't sweep on
    // un-grant by design — the historical event still happened).
    const gid = await garageId(target.id);
    await prisma.garageBadge.deleteMany({
      where: { garageId: gid, badgeCode: 'EVT-001' },
    });

    // Re-grant — GarageBadge lands again, but the Notification dedupeKey
    // collision swallows the second mint. The inbox MUST still hold exactly
    // one row for this (code, userId) pair.
    const r2 = await app.inject({ method: 'POST', url, headers });
    expect(r2.statusCode).toBe(201);

    const inbox = await prisma.notification.findMany({
      where: { userId: target.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.dedupeKey).toBe(badgeAwardedDedupeKey('EVT-001', target.id));
  });

  it('killswitch off — no award, no notification', async () => {
    await seedCatalog();
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user: admin } = await createUser({
      email: 'org-kill@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 'kill-notify@jdm.test',
      verified: true,
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/garage/badges/EVT-001/grant`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);

    const inbox = await prisma.notification.count({
      where: { userId: target.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toBe(0);
  });

  it('awarder service: notifyOnGrant=true mints inbox row', async () => {
    // Cover the service contract directly so callers other than the admin
    // route (future flows) get the same observable behavior.
    await seedCatalog();
    const { user } = await createUser({ email: 'svc-notify@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) =>
      awardBadge(tx, gid, 'EVT-001', 'admin:svc-test', {
        actorId: 'svc-test',
        notifyOnGrant: true,
      }),
    );
    expect(outcome).toEqual({ awarded: true });

    const inbox = await prisma.notification.findMany({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toHaveLength(1);
  });

  it('awarder service: default opts (no notifyOnGrant) does not mint inbox row', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'svc-silent@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) =>
      awardBadge(tx, gid, 'EVT-001', 'check_in:t1'),
    );
    expect(outcome).toEqual({ awarded: true });

    const inbox = await prisma.notification.count({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toBe(0);
  });
});
