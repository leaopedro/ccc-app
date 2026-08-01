import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GENERAL_SETTINGS_SINGLETON_ID } from '../../src/services/garage/killswitch.js';
import { awardXp, revertLikeXp } from '../../src/services/garage/xp-awarder.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('revertLikeXp — §C2 hard-delete + decrement-pair', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('hard-deletes the matching XpEvent row and decrements both counters', async () => {
    const { user } = await createUser({ email: 'rv1@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
    );
    const before = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(before.xp).toBe(1);
    expect(before.likesReceived).toBe(1);

    const outcome = await prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid));
    expect(outcome).toEqual({ reverted: true });
    expect(await prisma.xpEvent.findMany({ where: { garageId: gid } })).toHaveLength(0);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
    expect(g.likesReceived).toBe(0);
  });

  it('no prior row (killswitch was off at like time, then enabled before unlike) — returns reverted:false (replay-safe)', async () => {
    const { user } = await createUser({ email: 'rv2@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const skipped = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
    );
    expect(skipped).toEqual({ awarded: false, reason: 'gamification_disabled' });
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
    const seeded = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(seeded.likesReceived).toBe(0);

    await prisma.generalSettings.update({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      data: { gamificationEnabled: true },
    });
    const outcome = await prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid));
    expect(outcome).toEqual({ reverted: false, reason: 'not_found' });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
    expect(g.likesReceived).toBe(0);
  });

  it('killswitch off at unlike-time — short-circuits without touching DB', async () => {
    const { user } = await createUser({ email: 'rv3@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
    );
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const outcome = await prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid));
    expect(outcome).toEqual({ reverted: false, reason: 'gamification_disabled' });
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(1);
    expect(g.likesReceived).toBe(1);
  });

  it('sourceRef format uses opaque reactionId (§C3) — wrong reactionId is a no-op', async () => {
    const { user } = await createUser({ email: 'rv4@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
    );
    const outcome = await prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r-other', gid));
    expect(outcome).toEqual({ reverted: false, reason: 'not_found' });
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(1);
  });

  it('concurrent reverts — winner returns reverted:true, loser returns not_found (deleteMany race-safe)', async () => {
    const { user } = await createUser({ email: 'rv5@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
    );
    // Plain Promise.all (not allSettled) — neither tx may throw P2025 under the
    // deleteMany race-safe pattern. The loser cleanly returns not_found.
    const outcomes = await Promise.all([
      prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid)),
      prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid)),
    ]);
    const winners = outcomes.filter((o) => o.reverted === true);
    const losers = outcomes.filter((o) => o.reverted === false);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual({ reverted: false, reason: 'not_found' });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0); // never -1
    expect(g.likesReceived).toBe(0); // never -1
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
  });
});
