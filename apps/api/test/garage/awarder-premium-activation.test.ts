import { prisma } from '@ccc/db';
import { adminGarageSummarySchema } from '@ccc/shared/admin-garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { GENERAL_SETTINGS_SINGLETON_ID } from '../../src/services/garage/killswitch.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const grantPremium = async (
  app: FastifyInstance,
  orgId: string,
  targetId: string,
  payload: { tier: 'bronze' | 'silver' | 'gold' | null; premiumUntil: string | null },
) => {
  const env = loadEnv();
  return app.inject({
    method: 'POST',
    url: `/admin/users/${targetId}/garage/premium`,
    headers: { authorization: bearer(env, orgId, 'organizer') },
    payload,
  });
};

const garageIdFor = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('premium_activation XP hook (chunk 34)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('first premium grant awards +200 XP and writes one XpEvent row', async () => {
    const { user: org } = await createUser({
      email: 'o1@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't1@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    const res = await grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.premiumTier).toBe('gold');
    expect(body.isPremiumActive).toBe(true);

    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);

    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('premium_activation');
    expect(events[0]!.delta).toBe(200);
    expect(events[0]!.sourceRef).toBe(`garage:${gid}`);
  });

  it('lapse + re-activate does NOT award a second +200 (one-shot ever per §invariant 3)', async () => {
    const { user: org } = await createUser({
      email: 'o2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't2@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    // First grant.
    const r1 = await grantPremium(app, org.id, target.id, {
      tier: 'bronze',
      premiumUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(r1.statusCode).toBe(200);

    // Revoke (simulates lapse — admin pulls it; or premiumUntil elapses,
    // which the serializer handles, but the awarder side cares about the
    // grant write path either way).
    const r2 = await grantPremium(app, org.id, target.id, {
      tier: null,
      premiumUntil: null,
    });
    expect(r2.statusCode).toBe(200);

    // Re-grant (the "re-activate after lapse" boundary). The awarder hits
    // P2002 on @@unique([garageId, reason, sourceRef]) because the fixed
    // sourceRef `garage:<garageId>` collides; SAVEPOINT awardxp contains
    // the failure so the parent tx (premium update + audit) still commits.
    const r3 = await grantPremium(app, org.id, target.id, {
      tier: 'silver',
      premiumUntil: '2031-01-01T00:00:00.000Z',
    });
    expect(r3.statusCode).toBe(200);

    // §invariant 3: still exactly one XpEvent + Garage.xp still 200.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
    // The re-grant landed: premiumTier is back to silver.
    expect(g.premiumTier).toBe('silver');

    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.sourceRef).toBe(`garage:${gid}`);

    // Audit row count: 3 admin actions (grant, revoke, re-grant). The
    // awarder.swallowed-P2002 path MUST NOT touch the AdminAudit table.
    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    const actions = audits.map((a) => a.action).sort();
    expect(actions).toEqual([
      'garage.premium_grant',
      'garage.premium_grant',
      'garage.premium_revoke',
    ]);
  });

  it('killswitch off — premium grants succeed but no XpEvent or Garage.xp change', async () => {
    // Flip the killswitch before the grant. Use the canonical singleton id
    // from @ccc/shared/general-settings (re-exported via killswitch.ts) per
    // canon §8 — no string literals at call sites.
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { gamificationEnabled: false },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });

    const { user: org } = await createUser({
      email: 'o3@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't3@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    const res = await grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2030-01-01T00:00:00.000Z',
    });
    // Premium grant still works — killswitch only gates gamification.
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.premiumTier).toBe('gold');
    expect(body.isPremiumActive).toBe(true);

    // No XpEvent, Garage.xp unchanged.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(0);
  });

  it('revoke (no prior grant) does not award XP', async () => {
    const { user: org } = await createUser({
      email: 'o4@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't4@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    // A revoke against a never-granted garage. Admin UI shouldn't surface
    // this button, but the API must be defensive: tier=null with no prior
    // tier should NOT award the bonus.
    const res = await grantPremium(app, org.id, target.id, {
      tier: null,
      premiumUntil: null,
    });
    expect(res.statusCode).toBe(200);

    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(0);
  });

  // Reviewer fix: the awardXp call must gate on the NEW premium state being
  // ACTIVE, not just on `!isRevoke`. An admin can POST a grant with a tier
  // and a past premiumUntil — the row updates, but the grant is already
  // expired and the +200 must NOT fire.
  it('grant with past premiumUntil does NOT award (not active)', async () => {
    const { user: org } = await createUser({
      email: 'o6@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't6@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    const res = await grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2020-01-01T00:00:00.000Z',
    });
    // Grant itself still succeeds — only the awarder side is gated.
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.premiumTier).toBe('gold');
    // The serializer agrees: this grant is not active right now.
    expect(body.isPremiumActive).toBe(false);

    // No XP, no XpEvent row.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(0);
  });

  // Reviewer fix: covers the wasActive transition gate. Two consecutive
  // active grants (tier change with both states active) must award exactly
  // once. With the `!wasActive && isActive` gate, the second call's
  // pre-update snapshot sees wasActive=true, so the awarder is short-circuited
  // BEFORE awardXp is invoked — no XpEvent insert is attempted, no P2002
  // fires. The DB unique + awarder SAVEPOINT remain as defense in depth for
  // the concurrent inactive→active race (covered by the separate concurrent
  // grants test below).
  it('active-to-active update (tier change, both active) does NOT award a second +200', async () => {
    const { user: org } = await createUser({
      email: 'o7@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't7@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    const r1 = await grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await grantPremium(app, org.id, target.id, {
      tier: 'silver',
      premiumUntil: '2031-01-01T00:00:00.000Z',
    });
    expect(r2.statusCode).toBe(200);

    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
    expect(g.premiumTier).toBe('silver');

    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.sourceRef).toBe(`garage:${gid}`);
  });

  it('seeded active premium with NO prior XpEvent: active-to-active update does NOT award +200', async () => {
    // Simulates the production paths the reviewer identified:
    //   - first grant happened while killswitch was off
    //   - pre-Phase-2 premium grant (no awarder yet)
    //   - admin imported premium tier directly via SQL
    // In all three, Garage.premiumTier is non-null and active but the
    // XpEvent row was never written. Today's gate + P2002 fallback would
    // award +200 here; the wasActive transition gate prevents it.
    const { user: org } = await createUser({
      email: 'o9@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't9@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    // Seed active premium directly via prisma — bypasses the awarder, so no XpEvent.
    await prisma.garage.update({
      where: { id: gid },
      data: { premiumTier: 'bronze', premiumUntil: new Date('2030-01-01T00:00:00.000Z') },
    });
    // Sanity: pre-test state is active with no XpEvent.
    const pre = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(pre.xp).toBe(0);
    const preEvents = await prisma.xpEvent.count({ where: { garageId: gid } });
    expect(preEvents).toBe(0);

    // Active-to-active update (bronze → gold; both active windows).
    const res = await grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2031-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);

    // The new wasActive gate prevents the awarder call entirely.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(0);
    expect(g.premiumTier).toBe('gold');
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(0);
  });

  it('concurrent two-request premium grants — final Garage.xp === 200, exactly one XpEvent row (one-shot per §C1 + canon §4)', async () => {
    const { user: org } = await createUser({
      email: 'o5@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't5@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    // Two simultaneous grants targeting the same garage. The DB
    // `@@unique([garageId, reason, sourceRef])` plus the fixed
    // `sourceRef = 'garage:<garageId>'` make the loser hit P2002 inside
    // awardXp; the SAVEPOINT awardxp guard rolls back only the awarder's
    // writes and returns awarded:false silently. Both HTTP responses still
    // succeed — premium grant itself does not depend on the awarder write.
    const [r1, r2] = await Promise.all([
      grantPremium(app, org.id, target.id, {
        tier: 'gold',
        premiumUntil: '2030-01-01T00:00:00.000Z',
      }),
      grantPremium(app, org.id, target.id, {
        tier: 'silver',
        premiumUntil: '2031-01-01T00:00:00.000Z',
      }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    // Final XP exactly +200 — the duplicate side's P2002 was swallowed.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);

    // Exactly one premium_activation row with the canonical sourceRef.
    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.sourceRef).toBe(`garage:${gid}`);
    expect(events[0]!.delta).toBe(200);
  });
});
