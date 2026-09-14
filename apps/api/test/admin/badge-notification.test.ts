import { prisma } from '@ccc/db';
import {
  BADGE_AWARDED_NOTIFICATION_KIND,
  BADGE_AWARDED_NOTIFICATION_TITLE,
  badgeAwardedDedupeKey,
} from '@ccc/shared/badges-copy';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { awardBadge } from '../../src/services/garage/awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// Cover the chunk 22/conquista-celebracao contract: in-app notification
// fires on every successful grant, admin manual grant and auto-award
// write-path hooks alike, unless the caller passes `notifyOnGrant: false`.
// The dedupeKey is the single idempotency knob — a re-grant after un-grant,
// or a re-evaluation of the whole badge surface, must not double-notify.

const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        // Título deliberadamente diferente do canônico: é o que prova que o
        // corpo da notificação vem da linha do banco, e não de uma constante.
        title: 'Título Vindo do Banco',
        description: 'Descrição da fixture.',
      },
      {
        code: 'CAR-001',
        category: 'carros',
        rarity: 'common',
        icon: 'car',
        title: 'Conquista CAR-001',
        description: 'Descrição de CAR-001',
      },
      {
        code: 'CAR-003',
        category: 'carros',
        rarity: 'legendary',
        icon: 'curator',
        premiumExclusive: true,
        title: 'Conquista CAR-003',
        description: 'Descrição de CAR-003',
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
    expect(row.body).toBe('Título Vindo do Banco');
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
    expect(inbox[0]!.body).toBe('Conquista CAR-003');
  });

  it('auto-award (write-path hook) mints a notification', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'car-notify@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Honda', model: 'Civic', year: 2004, nickname: 'civic1', modifications: [] },
    });
    expect(res.statusCode).toBe(201);

    const inbox = await prisma.notification.count({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toBe(1);
  });

  it('reavaliar a superficie nao cria segunda notificacao', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'car-reeval@jdm.test', verified: true });
    const env = loadEnv();

    for (const model of ['Civic', 'Integra']) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          make: 'Honda',
          model,
          year: 2004,
          nickname: `nick ${model.toLowerCase()}`,
          modifications: [],
        },
      });
      expect(res.statusCode).toBe(201);
    }
    // O segundo carro reencontra CAR-001. O create estoura P2002 e o controle
    // pula para o catch de fora, entao o bloco de notificacao e inalcancavel.
    // Este teste e a trava contra alguem hoistar a notificacao para fora do try.
    const inbox = await prisma.notification.count({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(inbox).toBe(1);
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

  it('awarder service: default opts mints inbox row', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'svc-default@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await awardBadge(tx, gid, 'EVT-001', 'test:default');
    });
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    expect(row.dedupeKey).toBe(badgeAwardedDedupeKey('EVT-001', user.id));
    expect(row.destination).toEqual({ kind: 'internal_path', path: '/garage' });
  });
});
