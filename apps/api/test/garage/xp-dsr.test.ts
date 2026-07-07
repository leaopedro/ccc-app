import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { _collectUserDataForTest } from '../../src/services/data-export.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const garageOf = async (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

describe('DSR — XP surface coverage (chunk 28, canon §14)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('export: includes Garage.xp, Garage.likesReceived, and the user XpEvent rows', async () => {
    const { user } = await createUser({ email: 'dsr-xp@jdm.test', verified: true });
    const g = await garageOf(user.id);
    await prisma.garage.update({ where: { id: g.id }, data: { xp: 42, likesReceived: 3 } });
    await prisma.xpEvent.createMany({
      data: [
        { garageId: g.id, delta: 10, reason: 'post_create', sourceRef: 'post:abc' },
        { garageId: g.id, delta: 25, reason: 'badge_award', sourceRef: 'badge:COM-001' },
      ],
    });

    const bundle = await _collectUserDataForTest(user.id);
    const [garage] = bundle.data.garage as Array<Record<string, unknown>>;
    expect(garage!.xp).toBe(42);
    expect(garage!.likesReceived).toBe(3);

    const xpEvents = bundle.data.xpEvents as Array<Record<string, unknown>>;
    expect(xpEvents).toHaveLength(2);
    expect(xpEvents.map((e) => e.reason).sort()).toEqual(['badge_award', 'post_create']);
    expect(bundle.manifest.entities.map((e) => e.entity)).toContain('xpEvents');
  });

  it('anonymize: resets Garage.xp + likesReceived to 0 and deletes user XpEvent rows', async () => {
    const { user } = await createUser({ email: 'dsr-anon-xp@jdm.test', verified: true });
    const g = await garageOf(user.id);
    await prisma.garage.update({ where: { id: g.id }, data: { xp: 42, likesReceived: 3 } });
    await prisma.xpEvent.create({
      data: { garageId: g.id, delta: 10, reason: 'post_create', sourceRef: 'post:abc' },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: new Date() } });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);
    const scrubbed = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    expect(scrubbed.xp).toBe(0);
    expect(scrubbed.likesReceived).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: g.id } })).toBe(0);
  });

  it('anonymize: cleans XP surface even when the gamification killswitch is off', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user } = await createUser({ email: 'dsr-kill@jdm.test', verified: true });
    const g = await garageOf(user.id);
    await prisma.garage.update({ where: { id: g.id }, data: { xp: 7, likesReceived: 2 } });
    await prisma.xpEvent.create({
      data: { garageId: g.id, delta: 7, reason: 'post_create', sourceRef: 'post:xyz' },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
    });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);
    const scrubbed = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    expect(scrubbed.xp).toBe(0);
    expect(scrubbed.likesReceived).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: g.id } })).toBe(0);
  });
});
