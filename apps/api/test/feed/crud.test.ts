/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as deletionQueue from '../../src/services/uploads/deletion-queue.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEvent = (
  overrides: {
    feedAccess?: 'public' | 'attendees' | 'members_only';
    postingAccess?: 'attendees' | 'members_only' | 'organizers_only';
    feedEnabled?: boolean;
  } = {},
) =>
  prisma.event.create({
    data: {
      title: 'Feed Test Event',
      slug: `fte-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: overrides.feedEnabled ?? true,
      feedAccess: overrides.feedAccess ?? 'public',
      postingAccess: overrides.postingAccess ?? 'attendees',
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

const seedCar = (userId: string, opts?: { nickname?: string }) =>
  prisma.car.create({
    data: {
      userId,
      make: 'Honda',
      model: 'Civic',
      year: 2020,
      nickname: opts?.nickname ?? 'Civic',
    },
  });

describe('GET /events/:eventId/feed', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns 404 for unknown event', async () => {
    const res = await app.inject({ method: 'GET', url: '/events/unknown/feed' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with empty posts for public event (no auth)', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const res = await app.inject({ method: 'GET', url: `/events/${event.id}/feed` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posts).toEqual([]);
    expect(body.page).toBe(1);
    expect(body.total).toBe(0);
    expect(body.totalPages).toBe(0);
  });

  it('returns 403 for attendees event without auth', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const res = await app.inject({ method: 'GET', url: `/events/${event.id}/feed` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for attendees event with non-ticket user', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 for ticket holder on attendees event', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    await seedTicket(user.id, event.id, tier.id);
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 for disabled feed', async () => {
    const event = await seedEvent({ feedEnabled: false, feedAccess: 'public' });
    const res = await app.inject({ method: 'GET', url: `/events/${event.id}/feed` });
    expect(res.statusCode).toBe(403);
  });

  it('paginates with page and perPage params', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    for (let i = 0; i < 7; i++) {
      await prisma.feedPost.create({
        data: { eventId: event.id, body: `Post ${i}`, status: 'visible' },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed?page=1&perPage=5`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posts).toHaveLength(5);
    expect(body.total).toBe(7);
    expect(body.totalPages).toBe(2);
    expect(body.page).toBe(1);
  });

  it('page 2 returns remaining posts', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    for (let i = 0; i < 7; i++) {
      await prisma.feedPost.create({
        data: { eventId: event.id, body: `Post ${i}`, status: 'visible' },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed?page=2&perPage=5`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posts).toHaveLength(2);
    expect(body.page).toBe(2);
  });

  it('hides hidden/removed posts', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    await prisma.feedPost.create({
      data: { eventId: event.id, body: 'visible', status: 'visible' },
    });
    await prisma.feedPost.create({ data: { eventId: event.id, body: 'hidden', status: 'hidden' } });
    await prisma.feedPost.create({
      data: { eventId: event.id, body: 'removed', status: 'removed' },
    });
    const res = await app.inject({ method: 'GET', url: `/events/${event.id}/feed` });
    const body = res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].body).toBe('visible');
  });
});

describe('POST /events/:eventId/feed', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const event = await seedEvent();
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'Hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user has no ticket (attendees posting)', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'Hello' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates a post for ticket holder', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    await seedTicket(user.id, event.id, tier.id);
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'My first post' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.body).toBe('My first post');
    expect(body.eventId).toBe(event.id);
    expect(body.car).toBeNull();
  });

  it('creates a post with carId linking car', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    await seedTicket(user.id, event.id, tier.id);
    const car = await seedCar(user.id);
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'With car', carId: car.id },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.car).not.toBeNull();
    expect(body.car.id).toBe(car.id);
  });
});

describe('PATCH /events/:eventId/feed/:postId', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 401 without auth', async () => {
    const event = await seedEvent();
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'original', status: 'visible' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { body: 'updated' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not author', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'b@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'original', status: 'visible', authorUserId: author.id },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { body: 'hijack' },
      headers: { authorization: bearer(env, other.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when carId is included in patch', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'original', status: 'visible', authorUserId: user.id },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { body: 'updated', carId: 'some-car' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates body for author', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'original', status: 'visible', authorUserId: user.id },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { body: 'updated body' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.body).toBe('updated body');
  });

  it('keeps 200 when queue write fails during photo replacement patch', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'original', status: 'visible', authorUserId: user.id },
    });
    await prisma.feedPostPhoto.create({
      data: { postId: post.id, objectKey: `feed_photo/${user.id}/old.jpg`, sortOrder: 0 },
    });
    vi.spyOn(deletionQueue, 'queueObjectDeletion').mockRejectedValueOnce(new Error('queue down'));

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { photoObjectKeys: [`feed_photo/${user.id}/new.jpg`] },
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const photos = await prisma.feedPostPhoto.findMany({ where: { postId: post.id } });
    expect(photos).toHaveLength(1);
    expect(photos[0]?.objectKey).toBe(`feed_photo/${user.id}/new.jpg`);
  });
});

describe('DELETE /events/:eventId/feed/:postId', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 401 without auth', async () => {
    const event = await seedEvent();
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'x', status: 'visible' },
    });
    const res = await app.inject({ method: 'DELETE', url: `/events/${event.id}/feed/${post.id}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-author', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'a@jdm.test' });
    const { user: other } = await createUser({ email: 'b@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'x', status: 'visible', authorUserId: author.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/${post.id}`,
      headers: { authorization: bearer(env, other.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('soft-deletes post for author', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'x', status: 'visible', authorUserId: user.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/${post.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    const after = await prisma.feedPost.findUnique({ where: { id: post.id } });
    expect(after?.status).toBe('removed');
    expect(after?.hiddenAt).not.toBeNull();
  });

  it('deleted post no longer appears in feed list', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u2@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'gone', status: 'visible', authorUserId: user.id },
    });
    await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/${post.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    const list = await app.inject({ method: 'GET', url: `/events/${event.id}/feed` });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body) as { posts: Array<{ id: string }> };
    expect(body.posts.some((p) => p.id === post.id)).toBe(false);
  });

  it('keeps 204 when queue write fails after post delete', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'x', status: 'visible', authorUserId: user.id },
    });
    await prisma.feedPostPhoto.create({
      data: { postId: post.id, objectKey: `feed_photo/${user.id}/old.jpg`, sortOrder: 0 },
    });
    vi.spyOn(deletionQueue, 'queueObjectDeletion').mockRejectedValueOnce(new Error('queue down'));

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/${post.id}`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(204);
    const after = await prisma.feedPost.findUnique({ where: { id: post.id } });
    expect(after?.status).toBe('removed');
  });

  it('organizer can delete any post', async () => {
    const event = await seedEvent();
    const { user: author } = await createUser({ email: 'a@jdm.test' });
    const { user: org } = await createUser({ email: 'org@jdm.test', role: 'organizer' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'x', status: 'visible', authorUserId: author.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/${post.id}`,
      headers: { authorization: bearer(env, org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('GET /events/:eventId/feed/:postId/comments', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 404 for unknown post', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/unknown/comments`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns comments with pagination', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    for (let i = 0; i < 3; i++) {
      await prisma.feedComment.create({
        data: { postId: post.id, body: `Comment ${i}`, status: 'visible' },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comments).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it('hides hidden/removed comments', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    await prisma.feedComment.create({
      data: { postId: post.id, body: 'visible', status: 'visible' },
    });
    await prisma.feedComment.create({
      data: { postId: post.id, body: 'hidden', status: 'hidden' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
    });
    const body = res.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe('visible');
  });
});

describe('POST /events/:eventId/feed/:postId/comments', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 401 without auth', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/comments`,
      payload: { body: 'comment' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a comment for ticket holder', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    await seedTicket(user.id, event.id, tier.id);
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/comments`,
      payload: { body: 'nice car!' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.body).toBe('nice car!');
    expect(body.postId).toBe(post.id);
  });
});

describe('DELETE /events/:eventId/feed/comments/:commentId', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 401 without auth', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const comment = await prisma.feedComment.create({
      data: { postId: post.id, body: 'comment', status: 'visible' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/comments/${comment.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-author', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user: author } = await createUser({ email: 'a@jdm.test' });
    const { user: other } = await createUser({ email: 'b@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const comment = await prisma.feedComment.create({
      data: { postId: post.id, body: 'comment', status: 'visible', authorUserId: author.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/comments/${comment.id}`,
      headers: { authorization: bearer(env, other.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes comment for author', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const comment = await prisma.feedComment.create({
      data: { postId: post.id, body: 'comment', status: 'visible', authorUserId: user.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/comments/${comment.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    const deleted = await prisma.feedComment.findUnique({ where: { id: comment.id } });
    expect(deleted).toBeNull();
  });
});

describe('POST /events/:eventId/feed/:postId/reactions', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 401 without auth', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a like reaction', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.likes).toBe(1);
    expect(body.mine).toBe(true);
  });

  it('toggling same kind removes reaction', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.likes).toBe(0);
    expect(body.mine).toBe(false);
  });

  it('switching from like to dislike removes like atomically', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'dislike' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.likes).toBe(0);
    expect(body.mine).toBe(false);
    const rows = await prisma.feedReaction.findMany({
      where: { postId: post.id, userId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('dislike');
  });

  it('mine field agrees between reaction mutation and feed list after like->dislike', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    const switchRes = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'dislike' },
      headers: { authorization: bearer(env, user.id) },
    });
    const switchBody = switchRes.json();
    const feedRes = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, user.id) },
    });
    const feedBody = feedRes.json();
    expect(switchBody.mine).toBe(false);
    expect(feedBody.posts[0].reactions.mine).toBe(false);
    expect(switchBody.mine).toBe(feedBody.posts[0].reactions.mine);
  });

  it('returns 403 when user is banned from feed', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'banned@jdm.test' });
    const { user: admin } = await createUser({ email: 'admin@jdm.test' });
    await prisma.feedBan.create({
      data: {
        eventId: event.id,
        userId: user.id,
        scope: 'view',
        reason: 'test ban',
        bannedById: admin.id,
      },
    });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when eventId does not match post', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const otherEvent = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'u@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${otherEvent.id}/feed/${post.id}/reactions`,
      payload: { kind: 'like' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('carId ownership validation', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('rejects post create with another user car', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user: poster } = await createUser({ email: 'poster@jdm.test', verified: true });
    const { user: carOwner } = await createUser({ email: 'owner@jdm.test', verified: true });
    await seedTicket(poster.id, event.id, tier.id);
    const car = await seedCar(carOwner.id);
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'Spoofing car', carId: car.id },
      headers: { authorization: bearer(env, poster.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Car does not belong to you');
  });

  it('rejects comment create with another user car', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user: commenter } = await createUser({ email: 'commenter@jdm.test', verified: true });
    const { user: carOwner } = await createUser({ email: 'owner@jdm.test', verified: true });
    await seedTicket(commenter.id, event.id, tier.id);
    const car = await seedCar(carOwner.id);
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/comments`,
      payload: { body: 'Spoofing car', carId: car.id },
      headers: { authorization: bearer(env, commenter.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Car does not belong to you');
  });
});

describe('photoObjectKeys ownership validation', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('rejects post create with unowned photo key', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });
    await seedTicket(user.id, event.id, tier.id);
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'Stolen photo', photoObjectKeys: [`feed_photo/${other.id}/abc.jpg`] },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Photo does not belong to you');
  });

  it('accepts post create with owned photo key', async () => {
    const event = await seedEvent({ feedAccess: 'public', postingAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    await seedTicket(user.id, event.id, tier.id);
    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      payload: { body: 'My photo', photoObjectKeys: [`feed_photo/${user.id}/abc.jpg`] },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects patch with unowned photo key', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'original', status: 'visible', authorUserId: user.id },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { photoObjectKeys: [`feed_photo/${other.id}/abc.jpg`] },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Photo does not belong to you');
  });
});

describe('GET /events/:eventId/feed/:postId/comments - visibility guards', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('returns 404 for unknown event', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events/unknown/feed/some-post/comments',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NotFound');
  });

  it('returns 404 when parent post is hidden', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'hidden post', status: 'hidden' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when parent post is removed', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'removed post', status: 'removed' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for unauthenticated request on attendees-gated feed', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'gated post', status: 'visible' },
    });
    await prisma.feedComment.create({
      data: { postId: post.id, body: 'secret comment', status: 'visible' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns comments for authenticated attendee on attendees-gated feed', async () => {
    const event = await seedEvent({ feedAccess: 'attendees' });
    const tier = await seedTier(event.id);
    const { user } = await createUser({ email: 'attendee@jdm.test' });
    await seedTicket(user.id, event.id, tier.id);
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'gated post', status: 'visible' },
    });
    await prisma.feedComment.create({
      data: { postId: post.id, body: 'attendee comment', status: 'visible' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe('attendee comment');
  });
});

describe('tryAuth disabled-account check', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('disabled user token is ignored on optional-auth feed read', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'disabled@jdm.test' });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posts).toBeDefined();
  });
});

describe('write-side ban enforcement', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('banned user cannot PATCH own post', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'author@jdm.test' });
    const { user: admin } = await createUser({ email: 'admin@jdm.test' });
    const tier = await seedTier(event.id);
    await seedTicket(user.id, event.id, tier.id);
    const car = await seedCar(user.id);

    const post = await prisma.feedPost.create({
      data: {
        eventId: event.id,
        authorUserId: user.id,
        carId: car.id,
        body: 'hi',
        status: 'visible',
      },
    });

    await prisma.feedBan.create({
      data: {
        eventId: event.id,
        userId: user.id,
        scope: 'post',
        reason: 'test',
        bannedById: admin.id,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/feed/${post.id}`,
      payload: { body: 'edited' },
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('banned user cannot DELETE own post', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'author@jdm.test' });
    const { user: admin } = await createUser({ email: 'admin@jdm.test' });
    const tier = await seedTier(event.id);
    await seedTicket(user.id, event.id, tier.id);
    const car = await seedCar(user.id);

    const post = await prisma.feedPost.create({
      data: {
        eventId: event.id,
        authorUserId: user.id,
        carId: car.id,
        body: 'hi',
        status: 'visible',
      },
    });

    await prisma.feedBan.create({
      data: {
        eventId: event.id,
        userId: user.id,
        scope: 'post',
        reason: 'test',
        bannedById: admin.id,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/${post.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('banned user cannot DELETE own comment', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'author@jdm.test' });
    const { user: admin } = await createUser({ email: 'admin@jdm.test' });
    const tier = await seedTier(event.id);
    await seedTicket(user.id, event.id, tier.id);
    const car = await seedCar(user.id);

    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'post', status: 'visible' },
    });

    const comment = await prisma.feedComment.create({
      data: {
        postId: post.id,
        authorUserId: user.id,
        carId: car.id,
        body: 'hi',
        status: 'visible',
      },
    });

    await prisma.feedBan.create({
      data: {
        eventId: event.id,
        userId: user.id,
        scope: 'post',
        reason: 'test',
        bannedById: admin.id,
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/feed/comments/${comment.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('reaction toggle race safety', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('concurrent first likes do not 500', async () => {
    const event = await seedEvent({ feedAccess: 'public' });
    const { user } = await createUser({ email: 'racer@jdm.test' });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, body: 'race post', status: 'visible' },
    });

    const inject = () =>
      app.inject({
        method: 'POST',
        url: `/events/${event.id}/feed/${post.id}/reactions`,
        payload: { kind: 'like' },
        headers: { authorization: bearer(env, user.id) },
      });

    const results = await Promise.all([inject(), inject()]);
    const codes = results.map((r) => r.statusCode);
    expect(codes).not.toContain(500);
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});
