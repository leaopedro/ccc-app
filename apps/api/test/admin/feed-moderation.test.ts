/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEvent = () =>
  prisma.event.create({
    data: {
      title: 'Mod Event',
      slug: `mod-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'Test event',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T23:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: true,
    },
  });

const seedPost = (
  eventId: string,
  overrides: Partial<{ status: string; authorUserId: string }> = {},
) =>
  prisma.feedPost.create({
    data: {
      eventId,
      body: 'Test post body',
      status: (overrides.status as 'visible' | 'hidden' | 'removed') ?? 'visible',
      authorUserId: overrides.authorUserId ?? null,
    },
  });

const seedComment = (
  postId: string,
  overrides: Partial<{ status: string; authorUserId: string }> = {},
) =>
  prisma.feedComment.create({
    data: {
      postId,
      body: 'Test comment body',
      status: (overrides.status as 'visible' | 'hidden' | 'removed') ?? 'visible',
      authorUserId: overrides.authorUserId ?? null,
    },
  });

const seedReport = (
  targetKind: 'post' | 'comment',
  targetId: string,
  overrides: Partial<{ status: string; reporterUserId: string }> = {},
) =>
  prisma.report.create({
    data: {
      targetKind,
      postId: targetKind === 'post' ? targetId : null,
      commentId: targetKind === 'comment' ? targetId : null,
      reason: 'Inappropriate content',
      status: (overrides.status as 'open' | 'resolved' | 'dismissed') ?? 'open',
      reporterUserId: overrides.reporterUserId ?? null,
    },
  });

// ---------- Post moderation ----------

describe('POST /admin/events/:eventId/feed/posts/:postId/moderate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/any/feed/posts/any/moderate',
      payload: { action: 'hide' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/any/feed/posts/any/moderate',
      payload: { action: 'hide' },
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for non-existent post', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/posts/nonexistent/moderate`,
      payload: { action: 'hide' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('hides a visible post', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/posts/${post.id}/moderate`,
      payload: { action: 'hide' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ok: true, status: 'hidden' });

    const updated = await prisma.feedPost.findUnique({ where: { id: post.id } });
    expect(updated!.status).toBe('hidden');
    expect(updated!.hiddenById).toBe(org.id);
    expect(updated!.hiddenAt).not.toBeNull();
  });

  it('removes a post', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/posts/${post.id}/moderate`,
      payload: { action: 'remove' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('removed');

    const updated = await prisma.feedPost.findUnique({ where: { id: post.id } });
    expect(updated!.status).toBe('removed');
  });

  it('restores a hidden post', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id, { status: 'hidden' });
    // Set hiddenAt/hiddenById manually to verify they get cleared
    await prisma.feedPost.update({
      where: { id: post.id },
      data: { hiddenAt: new Date(), hiddenById: org.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/posts/${post.id}/moderate`,
      payload: { action: 'restore' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('visible');

    const updated = await prisma.feedPost.findUnique({ where: { id: post.id } });
    expect(updated!.status).toBe('visible');
    expect(updated!.hiddenById).toBeNull();
    expect(updated!.hiddenAt).toBeNull();
  });

  it('records audit on hide', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);

    await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/posts/${post.id}/moderate`,
      payload: { action: 'hide' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });

    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'feed.post.hide', entityId: post.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(org.id);
    expect(audit!.entityType).toBe('feed_post');
  });
});

// ---------- Comment moderation ----------

describe('POST /admin/events/:eventId/feed/comments/:commentId/moderate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('hides a visible comment', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const comment = await seedComment(post.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/comments/${comment.id}/moderate`,
      payload: { action: 'hide' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'hidden' });

    const updated = await prisma.feedComment.findUnique({ where: { id: comment.id } });
    expect(updated!.status).toBe('hidden');
    expect(updated!.hiddenById).toBe(org.id);
    expect(updated!.hiddenAt).not.toBeNull();
  });

  it('removes and then restores a comment', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const comment = await seedComment(post.id);

    // Remove
    const removeRes = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/comments/${comment.id}/moderate`,
      payload: { action: 'remove' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.json().status).toBe('removed');

    const removed = await prisma.feedComment.findUnique({ where: { id: comment.id } });
    expect(removed!.status).toBe('removed');

    // Restore
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/comments/${comment.id}/moderate`,
      payload: { action: 'restore' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json().status).toBe('visible');

    const restored = await prisma.feedComment.findUnique({ where: { id: comment.id } });
    expect(restored!.status).toBe('visible');
    expect(restored!.hiddenById).toBeNull();
    expect(restored!.hiddenAt).toBeNull();
  });

  it('returns 404 for non-existent comment', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/comments/nonexistent/moderate`,
      payload: { action: 'hide' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------- Report management ----------

describe('GET /admin/events/:eventId/feed/reports', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists open reports for an event', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: reporter } = await createUser({
      email: 'rep@jdm.test',
      verified: true,
      name: 'Reporter',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    await seedReport('post', post.id, { reporterUserId: reporter.id });
    await seedReport('post', post.id, { status: 'resolved' });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/feed/reports`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].status).toBe('open');
    expect(body.reports[0].reporterName).toBe('Reporter');
    expect(body.reports[0].targetKind).toBe('post');
  });

  it('filters by status query param', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    await seedReport('post', post.id, { status: 'open' });
    await seedReport('post', post.id, { status: 'resolved' });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/feed/reports?status=resolved`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].status).toBe('resolved');
  });
});

describe('POST /admin/events/:eventId/feed/reports/:reportId/resolve', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('resolves an open report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const report = await seedReport('post', post.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/${report.id}/resolve`,
      payload: { resolution: 'Content reviewed and action taken' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const updated = await prisma.report.findUnique({ where: { id: report.id } });
    expect(updated!.status).toBe('resolved');
    expect(updated!.resolution).toBe('Content reviewed and action taken');
    expect(updated!.resolverId).toBe(org.id);
    expect(updated!.resolvedAt).not.toBeNull();
  });

  it('returns 404 for non-existent report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/nonexistent/resolve`,
      payload: { resolution: 'Some resolution' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when resolving an already-resolved report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const report = await seedReport('post', post.id, { status: 'resolved' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/${report.id}/resolve`,
      payload: { resolution: 'Trying again' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });

  it('returns 409 when resolving a dismissed report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const report = await seedReport('post', post.id, { status: 'dismissed' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/${report.id}/resolve`,
      payload: { resolution: 'Trying again' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });
});

describe('POST /admin/events/:eventId/feed/reports/:reportId/dismiss', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('dismisses a report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const report = await seedReport('post', post.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/${report.id}/dismiss`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const updated = await prisma.report.findUnique({ where: { id: report.id } });
    expect(updated!.status).toBe('dismissed');
    expect(updated!.resolverId).toBe(org.id);
    expect(updated!.resolvedAt).not.toBeNull();
  });

  it('returns 409 when dismissing a resolved report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const report = await seedReport('post', post.id, { status: 'resolved' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/${report.id}/dismiss`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });

  it('returns 409 when dismissing an already-dismissed report', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const report = await seedReport('post', post.id, { status: 'dismissed' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/reports/${report.id}/dismiss`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });
});

// ---------- Ban management ----------

describe('POST /admin/events/:eventId/feed/bans', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a post ban', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 'target@jdm.test', verified: true });
    const event = await seedEvent();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/bans`,
      payload: { userId: target.id, scope: 'post', reason: 'Repeated violations' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.scope).toBe('post');
    expect(body.id).toBeDefined();

    const ban = await prisma.feedBan.findUnique({ where: { id: body.id } });
    expect(ban).not.toBeNull();
    expect(ban!.userId).toBe(target.id);
    expect(ban!.scope).toBe('post');
    expect(ban!.reason).toBe('Repeated violations');
    expect(ban!.bannedById).toBe(org.id);
  });

  it('creates a view ban', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 'target@jdm.test', verified: true });
    const event = await seedEvent();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/bans`,
      payload: { userId: target.id, scope: 'view' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().scope).toBe('view');
  });

  it('returns 409 for duplicate ban', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 'target@jdm.test', verified: true });
    const event = await seedEvent();

    // Create first ban
    await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/bans`,
      payload: { userId: target.id, scope: 'post' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });

    // Duplicate
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/bans`,
      payload: { userId: target.id, scope: 'post' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for non-existent event', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 'target@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/nonexistent/feed/bans',
      payload: { userId: target.id, scope: 'post' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-existent user', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/feed/bans`,
      payload: { userId: 'nonexistent', scope: 'post' },
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /admin/events/:eventId/feed/bans/:banId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes a ban and records audit', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 'target@jdm.test', verified: true });
    const event = await seedEvent();

    const ban = await prisma.feedBan.create({
      data: { eventId: event.id, userId: target.id, scope: 'post', bannedById: org.id },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}/feed/bans/${ban.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(204);

    const deleted = await prisma.feedBan.findUnique({ where: { id: ban.id } });
    expect(deleted).toBeNull();

    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'feed.ban.delete', entityId: ban.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(org.id);
  });

  it('returns 404 for non-existent ban', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}/feed/bans/nonexistent`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /admin/events/:eventId/feed/bans', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists bans for an event', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
      name: 'Org',
    });
    const { user: target } = await createUser({
      email: 'target@jdm.test',
      verified: true,
      name: 'Target',
    });
    const event = await seedEvent();

    await prisma.feedBan.create({
      data: {
        eventId: event.id,
        userId: target.id,
        scope: 'post',
        reason: 'Spam',
        bannedById: org.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/feed/bans`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bans).toHaveLength(1);
    expect(body.bans[0].userName).toBe('Target');
    expect(body.bans[0].bannedByName).toBe('Org');
    expect(body.bans[0].scope).toBe('post');
    expect(body.bans[0].reason).toBe('Spam');
  });
});

// ---------- Moderation queue ----------

describe('GET /admin/events/:eventId/feed/queue', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns hidden and reported posts in the queue', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();

    // Hidden post - should appear
    const hiddenPost = await seedPost(event.id, { status: 'hidden' });
    // Visible post with open report - should appear
    const reportedPost = await seedPost(event.id);
    await seedReport('post', reportedPost.id);
    // Clean visible post - should NOT appear
    await seedPost(event.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/feed/queue`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);

    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(hiddenPost.id);
    expect(ids).toContain(reportedPost.id);
  });

  it('returns empty queue for a clean event', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    await seedPost(event.id); // visible, no reports

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/feed/queue`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });

  it('includes comments in the queue', async () => {
    const { user: org } = await createUser({
      email: 'org@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const event = await seedEvent();
    const post = await seedPost(event.id);
    const hiddenComment = await seedComment(post.id, { status: 'hidden' });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/feed/queue`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe('comment');
    expect(body.items[0].id).toBe(hiddenComment.id);
  });
});
