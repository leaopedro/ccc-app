import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GENERAL_SETTINGS_SINGLETON_ID } from '../../src/services/garage/killswitch.js';
import { awardXp } from '../../src/services/garage/xp-awarder.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('awardXp — core service', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('event_checkin writes one XpEvent row (+10) and increments Garage.xp', async () => {
    const { user } = await createUser({ email: 'xp1@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const outcome = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }),
    );
    expect(outcome).toEqual({ awarded: true, delta: 10 });
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'event_checkin', sourceRef: 'event:e1', delta: 10 });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(10);
  });

  it('car_create awards +5', async () => {
    const { user } = await createUser({ email: 'xp2@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const outcome = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'car_create', { sourceRef: 'car:c1' }),
    );
    expect(outcome).toEqual({ awarded: true, delta: 5 });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(5);
  });

  it('post_create awards +2', async () => {
    const { user } = await createUser({ email: 'xp3@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const outcome = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_create', { sourceRef: 'post:p1' }),
    );
    expect(outcome).toEqual({ awarded: true, delta: 2 });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(2);
  });

  it('post_like awards +1 AND increments likesReceived (canon §6) with §C3 opaque-reaction-id sourceRef', async () => {
    const { user } = await createUser({ email: 'xp4@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const outcome = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
    );
    expect(outcome).toEqual({ awarded: true, delta: 1 });
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(1);
    const [first] = events;
    expect(first?.sourceRef).toBe('post:p1:reaction:r1');
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(1);
    expect(g.likesReceived).toBe(1);
  });

  it('badge_award rarity table — common +25, rare +50, legendary +100', async () => {
    const { user } = await createUser({ email: 'xp5@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const c = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'badge_award', { sourceRef: 'badge:B1', rarity: 'common' }),
    );
    expect(c).toEqual({ awarded: true, delta: 25 });
    const r = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'badge_award', { sourceRef: 'badge:B2', rarity: 'rare' }),
    );
    expect(r).toEqual({ awarded: true, delta: 50 });
    const l = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'badge_award', { sourceRef: 'badge:B3', rarity: 'legendary' }),
    );
    expect(l).toEqual({ awarded: true, delta: 100 });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(175);
  });

  it('premium_activation awards +200 once and is idempotent on the one-shot triple', async () => {
    const { user } = await createUser({ email: 'xp6@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const sourceRef = `garage:${gid}`;
    const first = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'premium_activation', { sourceRef }),
    );
    expect(first).toEqual({ awarded: true, delta: 200 });
    const second = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'premium_activation', { sourceRef }),
    );
    expect(second).toEqual({ awarded: false, reason: 'duplicate' });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });

  it('admin_adjustment accepts a positive signed delta (§C8)', async () => {
    const { user } = await createUser({ email: 'xp7@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const outcome = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'admin_adjustment', { sourceRef: 'admin:admin1:uuid-1', delta: 75 }),
    );
    expect(outcome).toEqual({ awarded: true, delta: 75 });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(75);
  });

  it('admin_adjustment accepts a negative signed delta (§C8 — signed, not two-call)', async () => {
    const { user } = await createUser({ email: 'xp8@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'admin_adjustment', { sourceRef: 'admin:admin1:uuid-seed', delta: 100 }),
    );
    await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'admin_adjustment', { sourceRef: 'admin:admin1:uuid-2', delta: -40 }),
    );
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(60);
    const rows = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(new Set(rows.map((e) => e.delta))).toEqual(new Set([100, -40]));
  });

  it('is idempotent — second call with same (garageId, reason, sourceRef) triple returns duplicate', async () => {
    const { user } = await createUser({ email: 'xp9@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const first = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }),
    );
    const second = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }),
    );
    expect(first).toEqual({ awarded: true, delta: 10 });
    expect(second).toEqual({ awarded: false, reason: 'duplicate' });
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(10);
  });

  // Regression for the SAVEPOINT contract in xp-awarder.ts (canon §5 + §C1).
  // Without `SAVEPOINT awardxp`, a P2002 from `tx.xpEvent.create` puts the
  // parent `$transaction` in state 25P02 (in_failed_sql_transaction). The
  // JS try/catch still returns `{ awarded:false, reason:'duplicate' }`, but
  // any subsequent parent-tx write silently aborts on commit. This test
  // proves the savepoint contains the P2002 to the awarder's writes so the
  // parent's follow-on write survives.
  it('same-sourceRef duplicate does NOT poison parent transaction', async () => {
    const { user } = await createUser({ email: 'xp-savepoint@jdm.test', verified: true });
    const gid = await garageId(user.id);
    // Seed the first XpEvent so the second create inside the parent tx
    // below collides on @@unique([garageId, reason, sourceRef]).
    await prisma.$transaction((tx) => awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }));

    // Inside ONE parent $transaction: (a) re-run awardXp on the same triple
    // (P2002 inside the awarder), (b) perform an unrelated write afterwards.
    // The follow-on write MUST persist on commit — the savepoint contained
    // the duplicate to the awarder's own writes only.
    const newName = 'Garage After Duplicate Award';
    const outcome = await prisma.$transaction(async (tx) => {
      const r = await awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' });
      // Follow-on parent-tx write — if the savepoint is missing, this aborts
      // silently because the tx is already in failed state.
      await tx.garage.update({ where: { id: gid }, data: { name: newName } });
      return r;
    });
    expect(outcome).toEqual({ awarded: false, reason: 'duplicate' });

    // Assertion that fails when the savepoint is absent: the parent-tx
    // follow-on write must be visible after commit.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.name).toBe(newName);
    // XP unchanged from the seed (still +10 only).
    expect(g.xp).toBe(10);
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(1);
  });

  it('different sourceRefs under the same reason are NOT duplicates', async () => {
    const { user } = await createUser({ email: 'xp10@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const a = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'car_create', { sourceRef: 'car:c1' }),
    );
    const b = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'car_create', { sourceRef: 'car:c2' }),
    );
    expect(a).toEqual({ awarded: true, delta: 5 });
    expect(b).toEqual({ awarded: true, delta: 5 });
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(10);
  });

  it('non-P2002 errors propagate so the parent tx rolls back (canon §5)', async () => {
    const { user } = await createUser({ email: 'xp10b@jdm.test', verified: true });
    const realGid = await garageId(user.id);
    const fakeGid = '00000000-0000-0000-0000-000000000000';
    await expect(
      prisma.$transaction((tx) => awardXp(tx, fakeGid, 'event_checkin', { sourceRef: 'event:e1' })),
    ).rejects.toThrow();
    expect(await prisma.xpEvent.count({ where: { garageId: realGid } })).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: fakeGid } })).toBe(0);
  });

  // Regression for the savepoint cleanup on the non-P2002 branch. Several
  // production callers (cars.ts, feed.ts, signup.ts, check-in.ts) log+swallow
  // awardBadge/awardXp errors instead of propagating them. Without the
  // unconditional ROLLBACK TO SAVEPOINT + RELEASE in the awarder catch, a
  // non-P2002 throw would leave the savepoint open and the parent tx in
  // state 25P02 — the follow-on parent write below would silently abort on
  // commit. We force a non-P2002 by passing a garage id that does not exist:
  // the FK on XpEvent.garageId fires on `tx.xpEvent.create` (Prisma P2003),
  // not P2002. The caller swallows the throw and proceeds with another write
  // on the real garage; commit must succeed and that follow-on write must be
  // visible afterwards.
  it('non-P2002 awarder error: savepoint rollback keeps parent tx writable for the caller', async () => {
    const { user } = await createUser({ email: 'xp-savepoint-nonp2002@jdm.test', verified: true });
    const realGid = await garageId(user.id);
    const fakeGid = '00000000-0000-0000-0000-000000000000';

    // Seed a follow-on side-effect target that the parent tx will update
    // AFTER the awarder throws + the caller swallows. The seed lives outside
    // the parent tx so the failed-state guard inside the tx is the only
    // thing that could prevent the update from landing.
    const seedName = 'before-failed-award';
    const followName = 'after-failed-award';
    await prisma.garage.update({ where: { id: realGid }, data: { name: seedName } });

    await prisma.$transaction(async (tx) => {
      try {
        // Non-P2002 throw from inside awardXp: FK violation on
        // `tx.xpEvent.create` because fakeGid has no Garage row.
        await awardXp(tx, fakeGid, 'event_checkin', { sourceRef: 'event:e1' });
      } catch {
        // Caller-swallow pattern (same shape as cars.ts:90, feed.ts:333,
        // signup.ts:61, check-in.ts:98). Without the savepoint cleanup
        // before the throw, this swallow would leave the parent tx in
        // 25P02 and the next write would silently abort on commit.
      }
      // Follow-on parent-tx write. Must persist on commit — proving the
      // parent tx is still writable after the swallowed non-P2002 throw.
      await tx.garage.update({ where: { id: realGid }, data: { name: followName } });
    });

    const g = await prisma.garage.findUniqueOrThrow({ where: { id: realGid } });
    expect(g.name).toBe(followName);
    // No xpEvent / garage.xp side effect from the failed awarder writes
    // (the savepoint rolled them back).
    expect(g.xp).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: realGid } })).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: fakeGid } })).toBe(0);
  });

  it('killswitch off — short-circuits before any DB write (no XpEvent, no Garage.xp change)', async () => {
    const { user } = await createUser({ email: 'xp11@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const outcome = await prisma.$transaction((tx) =>
      awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }),
    );
    expect(outcome).toEqual({ awarded: false, reason: 'gamification_disabled' });
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
  });

  it('same-tx safety — parent tx rollback unwrites the XpEvent row and Garage.xp increment', async () => {
    const { user } = await createUser({ email: 'xp12@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await expect(
      prisma.$transaction(async (tx) => {
        const outcome = await awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' });
        expect(outcome.awarded).toBe(true);
        throw new Error('forced parent rollback');
      }),
    ).rejects.toThrow('forced parent rollback');
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
  });

  // Canon §7 boundary guard: sourceRef is required and non-empty at the awarder
  // boundary. The DB column is nullable for migration compat, and Postgres
  // unique constraints do not dedupe NULL — a missing sourceRef would silently
  // break @@unique([garageId, reason, sourceRef]) idempotency. TS forbids
  // undefined/null at compile time; this runtime guard catches `as any` bypass
  // and empty string. Throws → parent tx rolls back per canon §5.
  it('empty sourceRef throws and the parent tx rolls back (no XpEvent, no Garage.xp change)', async () => {
    const { user } = await createUser({ email: 'xp13@jdm.test', verified: true });
    const gid = await garageId(user.id);
    await expect(
      prisma.$transaction((tx) => awardXp(tx, gid, 'event_checkin', { sourceRef: '' })),
    ).rejects.toThrow(/sourceRef.*required/);
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
  });

  it('missing sourceRef (bypass via cast) throws and the parent tx rolls back', async () => {
    const { user } = await createUser({ email: 'xp14@jdm.test', verified: true });
    const gid = await garageId(user.id);
    // Simulate a runtime bypass: TS would normally forbid this, but production
    // callers can hit it via `as any`, dynamic data, or a future refactor that
    // drops the type. The guard MUST fire before any DB work happens.
    const opts = { sourceRef: undefined as unknown as string };
    await expect(
      prisma.$transaction((tx) => awardXp(tx, gid, 'event_checkin', opts)),
    ).rejects.toThrow(/sourceRef.*required/);
    expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
  });
});
