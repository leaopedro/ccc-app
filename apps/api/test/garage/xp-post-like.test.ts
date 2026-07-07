import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as xpAwarder from '../../src/services/garage/xp-awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

type Fixture = {
  authorId: string;
  authorGarageId: string;
  likerId: string;
  eventId: string;
  postId: string;
};

// Canon §8 — singleton id is a string constant, never numeric 1.
const enableGamification = async () => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: { gamificationEnabled: true },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: true },
  });
};

const disableGamification = async () => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: { gamificationEnabled: false },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
  });
};

// Canon §9 — Event fixture must include type, capacity, published status, and
// feedAccess: 'public' (or a valid ticket for the liker). Mirrors apps/api/test/feed/crud.test.ts.
const buildFixture = async (): Promise<Fixture> => {
  const { user: author } = await createUser({ email: 'author@jdm.test', verified: true });
  const { user: liker } = await createUser({ email: 'liker@jdm.test', verified: true });
  const authorGarage = await prisma.garage.findUniqueOrThrow({ where: { userId: author.id } });
  const event = await prisma.event.create({
    data: {
      slug: 'react-evt',
      title: 'React Event',
      description: 'd',
      type: 'meeting',
      status: 'published',
      capacity: 100,
      startsAt: new Date('2026-06-01T10:00:00Z'),
      endsAt: new Date('2026-06-01T12:00:00Z'),
      feedEnabled: true,
      feedAccess: 'public',
    },
  });
  const post = await prisma.feedPost.create({
    data: {
      eventId: event.id,
      authorUserId: author.id,
      body: 'fixture post',
      status: 'visible',
    },
  });
  return {
    authorId: author.id,
    authorGarageId: authorGarage.id,
    likerId: liker.id,
    eventId: event.id,
    postId: post.id,
  };
};

const react = async (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  fx: Fixture,
  kind: 'like' | 'dislike',
) =>
  app.inject({
    method: 'POST',
    url: `/events/${fx.eventId}/feed/${fx.postId}/reactions`,
    headers: { authorization: bearer(env, fx.likerId) },
    payload: { kind },
  });

describe('awarder hook — feed post reactions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await enableGamification();
    app = await makeApp();
  });

  afterEach(async () => {
    // Centralize spy cleanup so any test that calls vi.spyOn() does not
    // leak a stub into the next test if its assertion block throws before
    // an inline spy.mockRestore() runs.
    vi.restoreAllMocks();
    await app.close();
  });

  it('no → like awards +1 XP and +1 likesReceived to the post author', async () => {
    const env = loadEnv();
    const fx = await buildFixture();

    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(200);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(1);
    expect(garage.likesReceived).toBe(1);

    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    const xp = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xp.delta).toBe(1);
    expect(xp.sourceRef).toBe(`post:${fx.postId}:reaction:${reaction.id}`);
  });

  it('like → none hard-deletes the XpEvent row, -1 XP, -1 likesReceived', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await react(app, env, fx, 'like');
    const res = await react(app, env, fx, 'like'); // toggle off
    expect(res.statusCode).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const xpRows = await prisma.xpEvent.findMany({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xpRows).toHaveLength(0);
    const reaction = await prisma.feedReaction.findUnique({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction).toBeNull();
  });

  it('no → dislike moves no XP, no likesReceived', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    const res = await react(app, env, fx, 'dislike');
    expect(res.statusCode).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const xpRows = await prisma.xpEvent.findMany({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xpRows).toHaveLength(0);
  });

  it('like → dislike reverts via revertLikeXp: -1 XP, -1 likesReceived, no XpEvent row', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await react(app, env, fx, 'like');
    const res = await react(app, env, fx, 'dislike');
    expect(res.statusCode).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const xpRows = await prisma.xpEvent.findMany({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xpRows).toHaveLength(0);
    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction.kind).toBe('dislike'); // row still exists, flipped
  });

  it('dislike → like awards +1 XP and +1 likesReceived', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await react(app, env, fx, 'dislike');
    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(1);
    expect(garage.likesReceived).toBe(1);
    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction.kind).toBe('like');
    const xp = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xp.delta).toBe(1);
    expect(xp.sourceRef).toBe(`post:${fx.postId}:reaction:${reaction.id}`);
  });

  it('dislike → none moves no XP, no likesReceived', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await react(app, env, fx, 'dislike');
    const res = await react(app, env, fx, 'dislike'); // toggle off
    expect(res.statusCode).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const reaction = await prisma.feedReaction.findUnique({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction).toBeNull();
  });

  it('killswitch off: like succeeds, no XP, no likesReceived', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await disableGamification();
    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(200);
    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction.kind).toBe('like');
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const xpRows = await prisma.xpEvent.findMany({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xpRows).toHaveLength(0);
  });

  it('non-P2002 awarder throw rolls back the entire reaction tx — no FeedReaction row, route 500s', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    // Force the awarder to throw an unexpected error inside the parent tx.
    // Mocking the awarder module call intercepts the route's awarder dispatch
    // regardless of which prisma client (tx or base) is passed in.
    vi.spyOn(xpAwarder, 'awardXp').mockImplementationOnce(() => {
      throw new Error('forced non-P2002 awarder failure');
    });

    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(500); // route does NOT swallow; throw propagates

    // Tx rollback: no FeedReaction row, no XpEvent row, garage counters untouched.
    const reaction = await prisma.feedReaction.findUnique({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction).toBeNull();
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const xpRows = await prisma.xpEvent.findMany({ where: { garageId: fx.authorGarageId } });
    expect(xpRows).toHaveLength(0);
    // spy cleanup handled by afterEach (vi.restoreAllMocks).
  });

  it('parent tx rollback: throw inside revertLikeXp leaves XP + counters + reaction at pre-attempt values', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await react(app, env, fx, 'like'); // baseline: xp=1, likesReceived=1, one XpEvent row, reaction.kind = 'like'

    // Force revertLikeXp to throw inside the parent tx. The route does NOT
    // catch awarder errors (canon §5), so the throw aborts the $transaction
    // and rolls back the feedReaction.update that already ran in this branch.
    vi.spyOn(xpAwarder, 'revertLikeXp').mockImplementationOnce(() => {
      throw new Error('forced parent-tx rollback via revert path');
    });

    const res = await react(app, env, fx, 'dislike'); // path C — will throw
    expect(res.statusCode).toBe(500); // route surfaces the throw
    // spy cleanup handled by afterEach (vi.restoreAllMocks).

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(after.xp).toBe(1); // rollback held
    expect(after.likesReceived).toBe(1);
    const afterXpCount = await prisma.xpEvent.count({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(afterXpCount).toBe(1);
    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction.kind).toBe('like'); // original 'like' row survived rollback
  });

  it('§C6: pre-launch like has no XpEvent — unlike is a safe no-op (no negative counters)', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    // Pre-launch state: FeedReaction row exists with no XpEvent. Garage stays at 0.
    await prisma.feedReaction.create({
      data: { postId: fx.postId, userId: fx.likerId, kind: 'like' },
    });
    const res = await react(app, env, fx, 'like'); // toggle off
    expect(res.statusCode).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0); // not -1
    expect(garage.likesReceived).toBe(0); // not -1
  });

  it('post with tombstoned author (authorUserId null): like succeeds, no XP movement anywhere', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await prisma.feedPost.update({
      where: { id: fx.postId },
      data: { authorUserId: null }, // simulate User deletion → SetNull
    });
    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(200);
    const xpRows = await prisma.xpEvent.findMany({});
    expect(xpRows).toHaveLength(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
  });

  it('post author exists but has no garage row: like succeeds, no XP movement', async () => {
    // TOCTOU surface area flagged 🟡 in the original chunk-32 review.
    // The route resolves `authorGarageId` via `prisma.garage.findUnique({
    // where: { userId: post.authorUserId } })` AFTER confirming
    // `post.authorUserId` is non-null. If the author's garage row is gone by
    // the time that lookup runs (manual deletion, future tombstone work),
    // `authorGarageId` stays null and the awarder dispatch is skipped — the
    // reaction still lands.
    const env = loadEnv();
    const fx = await buildFixture();
    // Delete the author's garage AFTER fixture setup. Cascades cleanly here:
    // the Garage row owns no XpEvent yet, so we just drop it directly.
    await prisma.garage.delete({ where: { id: fx.authorGarageId } });

    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(200);

    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction.kind).toBe('like'); // reaction landed
    const xpRows = await prisma.xpEvent.findMany({});
    expect(xpRows).toHaveLength(0); // no awarder dispatch
    const garage = await prisma.garage.findUnique({ where: { id: fx.authorGarageId } });
    expect(garage).toBeNull(); // garage stayed deleted (no resurrection)
  });

  it('race-lost path A with different kind replays peer row as path C, awarder fires correctly', async () => {
    // Deterministically reproduce the race: a concurrent peer has already
    // written a 'like' row for the same (postId, userId) by the time the
    // current request's `tx.feedReaction.create({ kind: 'dislike' })` runs.
    // Path A's create fails P2002, ROLLBACK TO + RELEASE the savepoint, then
    // the replay re-reads the peer row and runs path C (update to 'dislike').
    // The previous no-op behavior would have left the row at 'like' and
    // skipped the awarder revert; this test locks the replay behavior.
    const env = loadEnv();
    const fx = await buildFixture();
    // Pre-arm the race: wrap `prisma.$transaction` so that on the next
    // invocation, the tx callback's `tx.feedReaction.findUnique` is
    // monkey-patched to insert the peer 'like' row out-of-band (on a
    // separate prisma connection) immediately AFTER returning null. The
    // out-of-band insert commits before the route's `tx.feedReaction.create`
    // runs, so the create hits the unique constraint and raises P2002 —
    // exactly the race we want. The replay then re-reads the peer row and
    // runs path C (update to 'dislike'). vi.spyOn / restoreAllMocks does
    // not reliably restore Prisma method properties across tests, so we
    // save + restore the original via try/finally manually.
    const originalTransaction = prisma.$transaction.bind(prisma);
    let used = false;
    (prisma as unknown as { $transaction: unknown }).$transaction = ((
      arg: unknown,
      opts?: unknown,
    ) => {
      if (used || typeof arg !== 'function') {
        return (originalTransaction as (...a: unknown[]) => unknown)(arg, opts);
      }
      used = true;
      const userCallback = arg as (tx: unknown) => Promise<unknown>;
      return (originalTransaction as (...a: unknown[]) => unknown)(async (tx: unknown) => {
        const txClient = tx as {
          feedReaction: { findUnique: (args: unknown) => Promise<unknown> };
        };
        const realFindUnique = txClient.feedReaction.findUnique.bind(txClient.feedReaction);
        let injected = false;
        txClient.feedReaction.findUnique = (async (args: { where?: unknown }) => {
          const result = await realFindUnique(args);
          if (
            !injected &&
            result === null &&
            args?.where &&
            typeof args.where === 'object' &&
            'postId_userId' in args.where
          ) {
            injected = true;
            // Out-of-band peer insert on a separate connection. Commits
            // immediately so the route's subsequent tx.feedReaction.create
            // will hit the unique constraint and raise P2002.
            await prisma.feedReaction.create({
              data: { postId: fx.postId, userId: fx.likerId, kind: 'like' },
            });
          }
          return result;
        }) as typeof realFindUnique;
        return userCallback(tx);
      }, opts);
    }) as typeof prisma.$transaction;

    let res;
    try {
      res = await react(app, env, fx, 'dislike');
    } finally {
      (prisma as unknown as { $transaction: typeof originalTransaction }).$transaction =
        originalTransaction;
    }
    expect(res.statusCode).toBe(200); // replay ran path C, no surface error

    // Verify replay landed: row exists, flipped to 'dislike' (path C).
    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    expect(reaction.kind).toBe('dislike'); // replay flipped peer 'like' → 'dislike'

    // Awarder: was-like-now-not-like → revertLikeXp. But the peer's 'like'
    // row was inserted out-of-band (no XpEvent ever existed for it), so
    // revertLikeXp is a safe no-op against an absent XpEvent row. Net:
    // garage stays at zero and no XpEvent rows exist (canon §C6 semantics).
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
    const xpRows = await prisma.xpEvent.findMany({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xpRows).toHaveLength(0);
  });

  it('duplicate like POST (toggle-off) nets zero — no double XP increment', async () => {
    const env = loadEnv();
    const fx = await buildFixture();
    await react(app, env, fx, 'like');
    const beforeXp = await prisma.xpEvent.count({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(beforeXp).toBe(1);
    await react(app, env, fx, 'like'); // toggle off
    const afterXp = await prisma.xpEvent.count({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(afterXp).toBe(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
  });
});
