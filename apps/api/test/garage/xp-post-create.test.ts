/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as xpAwarder from '../../src/services/garage/xp-awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// NOTE: COM-001 is intentionally NOT seeded. This isolates the `post_create`
// XP delta from chunk 33's badge_award XP (which fires through the same
// awardBadge path when an eligibility branch matches). With no badge catalog
// rows, checkFeedEligibility returns []; the only XP write is post_create.

const seedEvent = (overrides: { feedAccess?: 'public' | 'attendees' | 'members_only' } = {}) =>
  prisma.event.create({
    data: {
      title: 'XP Post Create Test',
      slug: `xp-pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'd',
      startsAt: new Date('2026-06-01T10:00:00Z'),
      endsAt: new Date('2026-06-01T20:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: true,
      feedAccess: overrides.feedAccess ?? 'public',
      postingAccess: 'attendees',
    },
  });

const seedTier = (eventId: string) =>
  prisma.ticketTier.create({
    data: { eventId, name: 'Geral', priceCents: 0, quantityTotal: 100 },
  });

const seedTicket = (userId: string, eventId: string, tierId: string) =>
  prisma.ticket.create({
    data: { userId, eventId, tierId, source: 'purchase', status: 'valid' },
  });

// Posting requires a valid ticket because `postingAccess: 'attendees'`.
// Deviation from plan note: plan said `feedAccess: 'public'` allows any actor
// to post; that controls READ access. Mirror `apps/api/test/feed/crud.test.ts`
// pattern: seed tier + ticket for each posting user.
const seedEventWithTicket = async (userId: string) => {
  const event = await seedEvent();
  const tier = await seedTier(event.id);
  await seedTicket(userId, event.id, tier.id);
  return event;
};

const garageIdFor = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const createPost = async (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  userId: string,
  eventId: string,
  body = 'hello',
) =>
  app.inject({
    method: 'POST',
    url: `/events/${eventId}/feed`,
    headers: { authorization: bearer(env, userId) },
    payload: { body },
  });

describe('awarder hook — feed-post create awards +2 XP', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('single post awards +2 (1 XpEvent row, isolated post_create delta)', async () => {
    const { user } = await createUser({ email: 'xp-post-1@jdm.test', verified: true });
    const event = await seedEventWithTicket(user.id);
    const env = loadEnv();

    const res = await createPost(app, env, user.id, event.id);
    expect(res.statusCode).toBe(201);
    const postId = res.json().id as string;

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'post_create',
      sourceRef: `post:${postId}`,
      delta: 2,
    });
    // Assertion is on the post_create delta in isolation, NOT total Garage.xp,
    // because chunk 33 may later add badge_award XP through the same code path.
    // See note at top of file.
  });

  it('two posts award two post_create rows (idempotency on distinct sourceRefs)', async () => {
    const { user } = await createUser({ email: 'xp-post-2@jdm.test', verified: true });
    const event = await seedEventWithTicket(user.id);
    const env = loadEnv();

    const r1 = await createPost(app, env, user.id, event.id, 'one');
    const r2 = await createPost(app, env, user.id, event.id, 'two');
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceRef)).toEqual([
      `post:${r1.json().id as string}`,
      `post:${r2.json().id as string}`,
    ]);
  });

  it('same-sourceRef double-call is idempotent (P2002 swallowed by awarder)', async () => {
    // Drive idempotency directly through awardXp using a fixed sourceRef.
    // The HTTP route can't repeat the same postId naturally, so this asserts
    // the §C1 DB unique constraint is caught inside awardXp per fix-canon §5.
    const { user } = await createUser({ email: 'xp-post-3@jdm.test', verified: true });
    const event = await seedEventWithTicket(user.id);
    const env = loadEnv();

    const res = await createPost(app, env, user.id, event.id);
    expect(res.statusCode).toBe(201);
    const postId = res.json().id as string;
    const gid = await garageIdFor(user.id);

    // Re-invoke awardXp with the exact same triple; should return duplicate.
    const second = await prisma.$transaction(async (tx) =>
      xpAwarder.awardXp(tx, gid, 'post_create', { sourceRef: `post:${postId}` }),
    );
    expect(second).toMatchObject({ awarded: false, reason: 'duplicate' });

    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create', sourceRef: `post:${postId}` },
    });
    expect(rows).toHaveLength(1);
  });

  it('killswitch off → post created, no post_create XpEvent row', async () => {
    // Use the canonical singleton id constant (fix-canon §8). NEVER id: 1.
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { gamificationEnabled: false },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });
    const { user } = await createUser({ email: 'xp-post-4@jdm.test', verified: true });
    const event = await seedEventWithTicket(user.id);
    const env = loadEnv();

    const res = await createPost(app, env, user.id, event.id);
    expect(res.statusCode).toBe(201);

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
    });
    expect(rows).toHaveLength(0);
  });

  it('unexpected awarder throw rolls back the parent tx (no post, no XP row)', async () => {
    // Per fix-canon §5: awardXp catches only P2002 + killswitch; any other
    // error propagates so the parent prisma.$transaction rolls back. This is
    // the load-bearing same-tx invariant. The route MUST NOT wrap awardXp in
    // try/catch — if it did, the post would commit while XP is missing.
    const { user } = await createUser({ email: 'xp-post-5@jdm.test', verified: true });
    const event = await seedEventWithTicket(user.id);
    const env = loadEnv();

    const spy = vi
      .spyOn(xpAwarder, 'awardXp')
      .mockRejectedValueOnce(new Error('synthetic awarder failure'));

    const res = await createPost(app, env, user.id, event.id);
    // Route propagates the failure → 500.
    expect(res.statusCode).toBe(500);

    // No feed post should exist for this event.
    const posts = await prisma.feedPost.findMany({ where: { eventId: event.id } });
    expect(posts).toHaveLength(0);

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(rows).toHaveLength(0);

    spy.mockRestore();
  });

  it('route-level same-tx rollback: post + XP row are linked via parent tx', async () => {
    // Drives the REAL feed POST route and forces a failure AFTER awardXp
    // has ALREADY written its row inside the parent tx, then we throw to
    // abort the tx. Asserts that BOTH the post row AND the would-be XP
    // row are rolled back together — proving the hook splice lives inside
    // the parent feed-post `prisma.$transaction`, not on a separate
    // connection or after commit.
    //
    // This is the load-bearing distinction from test 5: test 5's reject
    // throws BEFORE any XP write, so it only proves "throw aborts the
    // post". This test makes the real awarder write first, then throws,
    // so the rollback assertion physically proves same-tx atomicity.
    const { user } = await createUser({ email: 'xp-post-6@jdm.test', verified: true });
    const event = await seedEventWithTicket(user.id);
    const env = loadEnv();

    // First call: let the awarder run normally (succeeds, +2).
    const r1 = await createPost(app, env, user.id, event.id, 'will-commit');
    expect(r1.statusCode).toBe(201);

    // Second call: spy that delegates to the REAL awarder (writes XpEvent
    // + bumps Garage.xp inside the parent tx) then throws to abort the tx.
    // If the splice is outside the parent tx, the XP row survives the
    // rollback and the assertion below fails.
    const realAwardXp = xpAwarder.awardXp;
    const spy = vi
      .spyOn(xpAwarder, 'awardXp')
      .mockImplementationOnce(async (tx, garageId, reason, opts) => {
        await realAwardXp(tx, garageId, reason, opts);
        throw new Error('forced rollback after real awardXp write');
      });
    const r2 = await createPost(app, env, user.id, event.id, 'will-rollback');
    expect(r2.statusCode).toBe(500);
    spy.mockRestore();

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
    });
    // Exactly one XP row from the first (committed) call. The second
    // call's awarder wrote inside the parent tx and was then rolled back.
    expect(rows).toHaveLength(1);

    const posts = await prisma.feedPost.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
    });
    // Only the first post survived; the second was rolled back.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toBe('will-commit');

    // Garage.xp reflects only the first (committed) award.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(2);
  });
});
