import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEvent = () =>
  prisma.event.create({
    data: {
      title: 'Block Test Event',
      slug: `bte-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: true,
      feedAccess: 'public',
      postingAccess: 'attendees',
    },
  });

describe('user blocks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const block = (actorId: string, targetId: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/me/blocks/${targetId}`,
      headers: { authorization: bearer(env, actorId, 'user') },
    });

  it('blocks, is idempotent, and lists', async () => {
    const { user: me } = await createUser({ email: 'blocker@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'blocked@jdm.test', verified: true });

    const first = await block(me.id, other.id);
    expect(first.statusCode).toBe(204);

    // PUT, not POST, precisely so a double tap is not an error.
    const second = await block(me.id, other.id);
    expect(second.statusCode).toBe(204);
    expect(await prisma.userBlock.count()).toBe(1);

    const list = await app.inject({
      method: 'GET',
      url: '/api/me/blocks',
      headers: { authorization: bearer(env, me.id, 'user') },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().blockedUserIds).toEqual([other.id]);
  });

  it('refuses self-block', async () => {
    const { user: me } = await createUser({ email: 'self@jdm.test', verified: true });

    const res = await block(me.id, me.id);

    expect(res.statusCode).toBe(422);
    expect(await prisma.userBlock.count()).toBe(0);
  });

  it('unblocks', async () => {
    const { user: me } = await createUser({ email: 'unblocker@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'unblocked@jdm.test', verified: true });
    await block(me.id, other.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/blocks/${other.id}`,
      headers: { authorization: bearer(env, me.id, 'user') },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.userBlock.count()).toBe(0);
  });

  it('hides the blocked author from the feed of whoever blocked them', async () => {
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'reader@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'noisy@jdm.test', verified: true });
    await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: other.id, body: 'post do bloqueado' },
    });
    await block(me.id, other.id);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, me.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().posts).toHaveLength(0);
  });

  it('hides the blocker from the blocked user too, symmetrically', async () => {
    // Asymmetric filtering would let the blocked person keep reading and
    // commenting on the blocker's posts, which is the harassment 1.2 targets.
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'sym-blocker@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'sym-blocked@jdm.test', verified: true });
    await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: me.id, body: 'post de quem bloqueou' },
    });
    await block(me.id, other.id);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, other.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().posts).toHaveLength(0);
  });

  it('leaves the feed untouched for unrelated users', async () => {
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'third-a@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'third-b@jdm.test', verified: true });
    const { user: bystander } = await createUser({ email: 'third-c@jdm.test', verified: true });
    await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: other.id, body: 'post visivel' },
    });
    await block(me.id, other.id);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, bystander.id, 'user') },
    });

    expect(res.json().posts).toHaveLength(1);
  });

  it('hides the blocked author from the comment list', async () => {
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'c-reader@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'c-noisy@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: me.id, body: 'meu post' },
    });
    await prisma.feedComment.create({
      data: { postId: post.id, authorUserId: other.id, body: 'comentario do bloqueado' },
    });
    await block(me.id, other.id);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed/${post.id}/comments`,
      headers: { authorization: bearer(env, me.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().comments).toHaveLength(0);
  });

  it('blocks the author of a post without the client knowing their id', async () => {
    // The feed payload deliberately does not expose authorUserId, so blocking
    // goes through the post and the server resolves the author.
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'ba-reader@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'ba-author@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: other.id, body: 'post a bloquear' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/events/${event.id}/feed/${post.id}/block-author`,
      headers: { authorization: bearer(env, me.id, 'user') },
    });

    expect(res.statusCode).toBe(204);
    const row = await prisma.userBlock.findFirstOrThrow({ where: { blockerId: me.id } });
    expect(row.blockedId).toBe(other.id);

    const feed = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, me.id, 'user') },
    });
    expect(feed.json().posts).toHaveLength(0);
  });

  it('refuses blocking the author of your own post', async () => {
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'ba-self@jdm.test', verified: true });
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: me.id, body: 'meu post' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/events/${event.id}/feed/${post.id}/block-author`,
      headers: { authorization: bearer(env, me.id, 'user') },
    });

    expect(res.statusCode).toBe(422);
    expect(await prisma.userBlock.count()).toBe(0);
  });

  it('does not filter anything for an anonymous reader', async () => {
    const event = await seedEvent();
    const { user: me } = await createUser({ email: 'anon-a@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'anon-b@jdm.test', verified: true });
    await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: other.id, body: 'post publico' },
    });
    await block(me.id, other.id);

    const res = await app.inject({ method: 'GET', url: `/events/${event.id}/feed` });

    expect(res.json().posts).toHaveLength(1);
  });
});
