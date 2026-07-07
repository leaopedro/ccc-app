import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import { beforeEach, describe, expect, it } from 'vitest';

import { awardBadge } from '../../src/services/garage/awarder.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedBadge = async (code: string, rarity: 'common' | 'rare' | 'legendary'): Promise<void> => {
  await prisma.badge.create({
    data: {
      code,
      category: code.startsWith('EVT')
        ? 'eventos'
        : code.startsWith('CAR')
          ? 'carros'
          : code.startsWith('COM')
            ? 'comunidade'
            : 'jdm',
      rarity,
      icon: 'flag',
      premiumExclusive: false,
    },
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('awardBadge → awardXp splice (chunk 33)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('common badge award fires +25 XpEvent with sourceRef "badge:<code>"', async () => {
    await seedBadge('EVT-001', 'common');
    const { user } = await createUser({ email: 'c1@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) =>
      awardBadge(tx, gid, 'EVT-001', 'check_in:t1'),
    );
    expect(outcome).toEqual({ awarded: true });

    const xpRow = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: gid, reason: 'badge_award' },
    });
    expect(xpRow.delta).toBe(25);
    expect(xpRow.sourceRef).toBe('badge:EVT-001');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(25);
  });

  it('rare badge award fires +50 XpEvent', async () => {
    await seedBadge('CAR-007', 'rare');
    const { user } = await createUser({ email: 'c2@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction((tx) => awardBadge(tx, gid, 'CAR-007', 'car:42'));

    const xpRow = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: gid, reason: 'badge_award' },
    });
    expect(xpRow.delta).toBe(50);
    expect(xpRow.sourceRef).toBe('badge:CAR-007');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(50);
  });

  it('legendary badge award fires +100 XpEvent', async () => {
    await seedBadge('JDM-099', 'legendary');
    const { user } = await createUser({ email: 'c3@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction((tx) => awardBadge(tx, gid, 'JDM-099', null));

    const xpRow = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: gid, reason: 'badge_award' },
    });
    expect(xpRow.delta).toBe(100);
    expect(xpRow.sourceRef).toBe('badge:JDM-099');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(100);
  });

  it('second awardBadge with same (garageId, code) does not write a second XpEvent', async () => {
    await seedBadge('COM-002', 'common');
    const { user } = await createUser({ email: 'c4@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const first = await prisma.$transaction((tx) => awardBadge(tx, gid, 'COM-002', 'a'));
    const second = await prisma.$transaction((tx) => awardBadge(tx, gid, 'COM-002', 'b'));

    expect(first).toEqual({ awarded: true });
    expect(second).toEqual({ awarded: false, reason: 'already_earned' });

    const xpRows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'badge_award' },
    });
    expect(xpRows).toHaveLength(1);
    expect(xpRows[0]?.delta).toBe(25);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(25);
  });

  it('killswitch off short-circuits at awardBadge — no GarageBadge + no XpEvent', async () => {
    await seedBadge('EVT-002', 'common');
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user } = await createUser({ email: 'c5@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) => awardBadge(tx, gid, 'EVT-002'));
    expect(outcome).toEqual({ awarded: false, reason: 'gamification_disabled' });

    const badges = await prisma.garageBadge.count({ where: { garageId: gid } });
    expect(badges).toBe(0);

    const xpRows = await prisma.xpEvent.count({ where: { garageId: gid } });
    expect(xpRows).toBe(0);
  });

  it('admin manual grant with allowAdminOverride awards XP by rarity', async () => {
    await seedBadge('JDM-555', 'legendary');
    // Mark legendary as premium-exclusive to exercise the override path.
    await prisma.badge.update({
      where: { code: 'JDM-555' },
      data: { premiumExclusive: true },
    });
    const { user } = await createUser({ email: 'c6@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) =>
      awardBadge(tx, gid, 'JDM-555', 'admin:adm_1', {
        actorId: 'admin:adm_1',
        allowAdminOverride: true,
        notifyOnGrant: true,
      }),
    );
    expect(outcome).toEqual({ awarded: true });

    const xpRow = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: gid, reason: 'badge_award' },
    });
    expect(xpRow.delta).toBe(100);
    expect(xpRow.sourceRef).toBe('badge:JDM-555');
  });

  it('parent tx rollback drops GarageBadge AND XpEvent', async () => {
    await seedBadge('EVT-777', 'rare');
    const { user } = await createUser({ email: 'c8@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await expect(
      prisma.$transaction(async (tx) => {
        await awardBadge(tx, gid, 'EVT-777', 'check_in:rollback');
        throw new Error('parent tx aborts');
      }),
    ).rejects.toThrow('parent tx aborts');

    const badges = await prisma.garageBadge.count({ where: { garageId: gid } });
    expect(badges).toBe(0);
    const xpRows = await prisma.xpEvent.count({ where: { garageId: gid } });
    expect(xpRows).toBe(0);
    const audits = await prisma.adminAudit.count({
      where: { entityType: 'garage', entityId: gid, action: 'badge.award' },
    });
    expect(audits).toBe(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(0);
  });
});
