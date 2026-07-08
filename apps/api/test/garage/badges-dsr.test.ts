import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { _collectUserDataForTest } from '../../src/services/data-export.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const seedBadge = async (code: string) => {
  await prisma.badge.create({
    data: { code, category: 'eventos', rarity: 'common', icon: 'flag' },
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('anonymizeUser — Conquistas cleanup (§C17)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("deletes the user's earned GarageBadge rows inside the anonymize tx", async () => {
    await seedBadge('EVT-001');
    const { user } = await createUser({ email: 'dsr-anon@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.garageBadge.create({
      data: { garageId: gid, badgeCode: 'EVT-001', pinned: true, pinnedAt: new Date() },
    });

    // Flip the user to 'deleted' so anonymize will run.
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
    });
    await prisma.deletionLog.create({
      data: { userId: user.id, requestedAt: new Date() },
    });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);

    const remaining = await prisma.garageBadge.count({ where: { garageId: gid } });
    expect(remaining).toBe(0);
  });

  it('runs the cleanup even when the gamification killswitch is off', async () => {
    await seedBadge('EVT-001');
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      create: { id: 'general_default', gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user } = await createUser({ email: 'dsr-kill@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.garageBadge.create({
      data: { garageId: gid, badgeCode: 'EVT-001' },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
    });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);

    const remaining = await prisma.garageBadge.count({ where: { garageId: gid } });
    expect(remaining).toBe(0);
  });
});

describe('data-export collector — Conquistas inclusion (§C17)', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("includes the user's GarageBadge rows in the export bundle", async () => {
    await seedBadge('EVT-001');
    await prisma.badge.create({
      data: { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car' },
    });
    const { user } = await createUser({ email: 'export-badges@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const earnedAt1 = new Date('2026-04-01T10:00:00Z');
    const earnedAt2 = new Date('2026-04-15T10:00:00Z');
    await prisma.garageBadge.create({
      data: {
        garageId: gid,
        badgeCode: 'EVT-001',
        earnedAt: earnedAt1,
        pinned: true,
        pinnedAt: earnedAt1,
        sourceRef: 'check_in:t1',
      },
    });
    await prisma.garageBadge.create({
      data: {
        garageId: gid,
        badgeCode: 'CAR-001',
        earnedAt: earnedAt2,
        sourceRef: 'car:c1',
      },
    });

    const bundle = await _collectUserDataForTest(user.id);
    const rows = bundle.data['garageBadges'] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    // Ordered by earnedAt asc — EVT-001 is older.
    expect(rows[0]!['badgeCode']).toBe('EVT-001');
    expect(rows[0]!['pinned']).toBe(true);
    expect(rows[0]!['sourceRef']).toBe('check_in:t1');
    expect(rows[1]!['badgeCode']).toBe('CAR-001');

    // id + garageId NOT exposed (re-derivable).
    expect('id' in rows[0]!).toBe(false);
    expect('garageId' in rows[0]!).toBe(false);

    // Manifest entity entry is present.
    const entity = bundle.manifest.entities.find((e) => e.entity === 'garageBadges');
    expect(entity?.count).toBe(2);
  });
});
