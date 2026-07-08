import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { awardBadge } from '../../src/services/garage/awarder.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const seedBadge = async (
  code: string,
  opts: { premiumExclusive?: boolean } = {},
): Promise<void> => {
  await prisma.badge.create({
    data: {
      code,
      category: code.startsWith('EVT')
        ? 'eventos'
        : code.startsWith('CAR')
          ? 'carros'
          : code.startsWith('COM')
            ? 'comunidade'
            : 'ccc',
      rarity: 'common',
      icon: 'flag',
      premiumExclusive: opts.premiumExclusive ?? false,
    },
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('awardBadge — core service', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('awards a non-premium badge and writes a badge.award audit row', async () => {
    await seedBadge('EVT-001');
    const { user } = await createUser({ email: 'a1@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) =>
      awardBadge(tx, gid, 'EVT-001', 'check_in:t1'),
    );

    expect(outcome.awarded).toBe(true);

    const earned = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'EVT-001' },
    });
    expect(earned.sourceRef).toBe('check_in:t1');

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { action: 'badge.award', actorId: 'system:awarder' },
    });
    expect(audit.entityType).toBe('garage');
    expect(audit.entityId).toBe(gid);
    const meta = audit.metadata as { badgeCode: string; sourceRef: string };
    expect(meta.badgeCode).toBe('EVT-001');
    expect(meta.sourceRef).toBe('check_in:t1');
  });

  it('is idempotent — second call with same (garageId, code) returns already_earned', async () => {
    await seedBadge('CAR-001');
    const { user } = await createUser({ email: 'a2@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const first = await prisma.$transaction((tx) => awardBadge(tx, gid, 'CAR-001', 'car:1'));
    const second = await prisma.$transaction((tx) => awardBadge(tx, gid, 'CAR-001', 'car:2'));

    expect(first).toEqual({ awarded: true });
    expect(second).toEqual({ awarded: false, reason: 'already_earned' });

    const count = await prisma.garageBadge.count({
      where: { garageId: gid, badgeCode: 'CAR-001' },
    });
    expect(count).toBe(1);
  });

  it('returns gamification_disabled when the killswitch is off — no row, no audit', async () => {
    await seedBadge('EVT-001');
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user } = await createUser({ email: 'a3@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) => awardBadge(tx, gid, 'EVT-001'));
    expect(outcome).toEqual({ awarded: false, reason: 'gamification_disabled' });

    const count = await prisma.garageBadge.count({ where: { garageId: gid } });
    expect(count).toBe(0);
    const audit = await prisma.adminAudit.count({ where: { action: 'badge.award' } });
    expect(audit).toBe(0);
  });

  it('rejects premium-exclusive grant on a free garage with premium_required', async () => {
    await seedBadge('CAR-003', { premiumExclusive: true });
    const { user } = await createUser({ email: 'a4@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) => awardBadge(tx, gid, 'CAR-003'));
    expect(outcome).toEqual({ awarded: false, reason: 'premium_required' });

    const count = await prisma.garageBadge.count({ where: { garageId: gid } });
    expect(count).toBe(0);
  });

  it('grants premium-exclusive on a free garage when allowAdminOverride is true', async () => {
    await seedBadge('CCC-003', { premiumExclusive: true });
    const { user } = await createUser({ email: 'a5@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) =>
      awardBadge(tx, gid, 'CCC-003', 'admin:adm-1', {
        actorId: 'adm-1',
        allowAdminOverride: true,
      }),
    );
    expect(outcome).toEqual({ awarded: true });

    const earned = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'CCC-003' },
    });
    expect(earned.sourceRef).toBe('admin:adm-1');

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { action: 'badge.award' },
    });
    expect(audit.actorId).toBe('adm-1');
  });

  it('grants premium-exclusive on a premium-active garage without override', async () => {
    await seedBadge('CAR-003', { premiumExclusive: true });
    const { user } = await createUser({ email: 'a6@jdm.test', verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: { premiumTier: 'gold', premiumUntil: null },
    });
    const gid = await garageId(user.id);

    const outcome = await prisma.$transaction((tx) => awardBadge(tx, gid, 'CAR-003'));
    expect(outcome).toEqual({ awarded: true });
  });

  it('throws for an unknown badge code (caller bug)', async () => {
    const { user } = await createUser({ email: 'a7@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await expect(prisma.$transaction((tx) => awardBadge(tx, gid, 'XXX-999'))).rejects.toThrow(
      /unknown badge XXX-999/,
    );
  });
});
