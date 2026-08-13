import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEvent = (feedAccess: 'public' | 'attendees' | 'members_only' = 'public') =>
  prisma.event.create({
    data: {
      title: 'Report Test Event',
      slug: `rte-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: true,
      feedAccess,
      postingAccess: 'attendees',
    },
  });

const seedPost = (eventId: string, authorUserId: string) =>
  prisma.feedPost.create({ data: { eventId, authorUserId, body: 'post denunciável' } });

const seedComment = (postId: string, authorUserId: string) =>
  prisma.feedComment.create({ data: { postId, authorUserId, body: 'comentário denunciável' } });

/** Three distinct verified reporters, which is the auto-hide threshold. */
const seedReporters = async (n: number) => {
  const out: Array<{ id: string }> = [];
  for (let i = 0; i < n; i++) {
    const { user } = await createUser({
      email: `reporter-${i}-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
      verified: true,
    });
    out.push({ id: user.id });
  }
  return out;
};

describe('POST /events/:eventId/feed/:postId/report', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const report = (eventId: string, postId: string, userId: string, reason = 'conteúdo ofensivo') =>
    app.inject({
      method: 'POST',
      url: `/events/${eventId}/feed/${postId}/report`,
      headers: { authorization: bearer(env, userId, 'user') },
      payload: { reason },
    });

  it('creates an open Report row', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'author@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const [reporter] = await seedReporters(1);

    const res = await report(event.id, post.id, reporter!.id);

    expect(res.statusCode).toBe(201);
    const rows = await prisma.report.findMany({ where: { postId: post.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.targetKind).toBe('post');
    expect(rows[0]!.reporterUserId).toBe(reporter!.id);
  });

  it('is idempotent for the same reporter and target', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'author2@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const [reporter] = await seedReporters(1);

    await report(event.id, post.id, reporter!.id);
    const second = await report(event.id, post.id, reporter!.id);

    // Reporting twice is not a user error: ack it and keep one row.
    expect([200, 201]).toContain(second.statusCode);
    expect(await prisma.report.count({ where: { postId: post.id } })).toBe(1);
  });

  it('auto-hides the post on the third distinct reporter', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'author3@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const reporters = await seedReporters(3);

    await report(event.id, post.id, reporters[0]!.id);
    await report(event.id, post.id, reporters[1]!.id);

    let row = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.status).toBe('visible');

    const third = await report(event.id, post.id, reporters[2]!.id);

    expect(third.json()).toMatchObject({ autoHidden: true });
    row = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.status).toBe('hidden');
    expect(row.hiddenAt).not.toBeNull();
    // hiddenById null distinguishes a system auto-hide from a moderator action.
    expect(row.hiddenById).toBeNull();
  });

  it('does not auto-hide from repeated reports by one user', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'author4@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const [reporter] = await seedReporters(1);

    await report(event.id, post.id, reporter!.id);
    await report(event.id, post.id, reporter!.id);
    await report(event.id, post.id, reporter!.id);

    const row = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.status).toBe('visible');
  });

  it('refuses a reporter who cannot even read the feed', async () => {
    // Shipped without this gate: an outsider with no ticket could report on a
    // feed they are not allowed to see, and three throwaway accounts could push
    // any post past the auto-hide threshold.
    const event = await seedEvent('attendees');
    const { user: author } = await createUser({ email: 'gate-author@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const [outsider] = await seedReporters(1);

    const res = await report(event.id, post.id, outsider!.id);

    expect(res.statusCode).toBe(403);
    expect(await prisma.report.count()).toBe(0);
  });

  it('refuses a reporter banned from the feed', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'ban-author@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const [banned] = await seedReporters(1);
    const { user: staff } = await createUser({ email: 'ban-staff@jdm.test', verified: true });
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: banned!.id, scope: 'view', bannedById: staff.id },
    });

    const res = await report(event.id, post.id, banned!.id);

    expect(res.statusCode).toBe(403);
    expect(await prisma.report.count()).toBe(0);
  });

  it('refuses a reporter whose email is not verified', async () => {
    // Signup hands out a working token with emailVerifiedAt null, and each new
    // email opens its own rate-limit bucket, so unverified accounts are free and
    // unlimited — the wrong cost model for hiding other people's content.
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'unv-author@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const { user: unverified } = await createUser({
      email: 'unverified@jdm.test',
      verified: false,
    });

    const res = await report(event.id, post.id, unverified.id);

    expect(res.statusCode).toBe(403);
    expect(await prisma.report.count()).toBe(0);
  });

  it('a duplicate report does not re-hide a post a moderator restored', async () => {
    // The counter must never override a moderator. Restoring leaves the Report
    // rows `open` (dismissal is per-report), so re-evaluating the threshold on a
    // duplicate let one attacker re-hide the post indefinitely.
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'restore-author@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const reporters = await seedReporters(3);

    for (const r of reporters) await report(event.id, post.id, r.id);
    expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      'hidden',
    );

    // Moderator restores, without dismissing every report.
    await prisma.feedPost.update({
      where: { id: post.id },
      data: { status: 'visible', hiddenAt: null, hiddenById: null },
    });

    const replay = await report(event.id, post.id, reporters[0]!.id);

    expect(replay.json()).toMatchObject({ autoHidden: false });
    expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      'visible',
    );
  });

  it('rejects an unauthenticated report', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'author5@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/report`,
      payload: { reason: 'spam' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty reason', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'author6@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const [reporter] = await seedReporters(1);

    const res = await report(event.id, post.id, reporter!.id, '');

    expect(res.statusCode).toBe(422);
  });

  it('returns 404 for an unknown post', async () => {
    const event = await seedEvent();
    const [reporter] = await seedReporters(1);

    const res = await report(event.id, 'nope', reporter!.id);

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /events/:eventId/feed/comments/:commentId/report', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('auto-hides the comment and leaves the post visible', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'cauthor@jdm.test', verified: true });
    const post = await seedPost(event.id, author.id);
    const comment = await seedComment(post.id, author.id);
    const reporters = await seedReporters(3);

    for (const r of reporters) {
      await app.inject({
        method: 'POST',
        url: `/events/${event.id}/feed/comments/${comment.id}/report`,
        headers: { authorization: bearer(env, r.id, 'user') },
        payload: { reason: 'spam' },
      });
    }

    const commentRow = await prisma.feedComment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(commentRow.status).toBe('hidden');

    const postRow = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(postRow.status).toBe('visible');

    const rows = await prisma.report.findMany({ where: { commentId: comment.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.targetKind === 'comment')).toBe(true);
  });
});
