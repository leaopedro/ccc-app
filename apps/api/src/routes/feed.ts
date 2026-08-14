import { prisma } from '@ccc/db';
import {
  feedCommentCreateInputSchema,
  feedCommentListResponseSchema,
  feedCommentResponseSchema,
  feedListResponseSchema,
  feedPostCreateInputSchema,
  feedPostPatchInputSchema,
  feedPostResponseSchema,
  feedReactionInputSchema,
} from '@ccc/shared/feed';
import { reportCreateRequestSchema } from '@ccc/shared/reports';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { requireUser } from '../plugins/auth.js';
import { fileReport } from '../services/feed/report.js';
import { checkFeedPostAccess, checkFeedReadAccess, isFeedBanned } from '../services/feed/access.js';
import { blockedUserIdsFor, isBlockedBetween } from '../services/feed/blocks.js';
import { awardBadge } from '../services/garage/awarder.js';
import { checkEligibility as checkFeedEligibility } from '../services/garage/eligibility/feed.js';
import rateLimit from '@fastify/rate-limit';
import { computeIsPremiumActive } from '../services/garage/index.js';
import { awardXp, revertLikeXp } from '../services/garage/xp-awarder.js';
import { queueObjectDeletion } from '../services/uploads/deletion-queue.js';

const eventIdParam = z.object({ eventId: z.string().min(1) });
const postIdParam = z.object({ eventId: z.string().min(1), postId: z.string().min(1) });
const commentIdParam = z.object({ eventId: z.string().min(1), commentId: z.string().min(1) });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

const CAR_SELECT = {
  id: true,
  make: true,
  model: true,
  year: true,
  nickname: true,
  modifications: true,
  photos: { select: { objectKey: true, width: true, height: true, sortOrder: true } },
  // Needed to compute isPremiumActive on the public car profile. The badge
  // tone is per-Garage (one badge per car owner), so we pull premiumTier +
  // premiumUntil and feed them through computeIsPremiumActive at serialize
  // time. Never expose the raw timestamp publicly.
  user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
} as const;

const POST_SELECT = {
  id: true,
  eventId: true,
  body: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  authorUserId: true,
  car: { select: CAR_SELECT },
  photos: { select: { id: true, objectKey: true, width: true, height: true, sortOrder: true } },
  _count: {
    select: { reactions: { where: { kind: 'like' } }, comments: { where: { status: 'visible' } } },
  },
} as const;

type CarSelect = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  modifications: string[];
  photos: { objectKey: string; width: number | null; height: number | null; sortOrder: number }[];
  user: {
    garage: {
      premiumTier: 'bronze' | 'silver' | 'gold' | null;
      premiumUntil: Date | null;
    } | null;
  } | null;
};

const serializeCarProfile = (car: CarSelect | null, buildUrl: (key: string) => string) => {
  if (!car) return null;
  const primary = [...car.photos].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
  const garage = car.user?.garage ?? null;
  const isPremiumActive =
    garage === null ? false : computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  return {
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    modifications: car.modifications,
    photo: primary
      ? { url: buildUrl(primary.objectKey), width: primary.width, height: primary.height }
      : null,
    isPremiumActive,
  };
};

export const feedRoutes: FastifyPluginAsync = async (app) => {
  // ---- GET /events/:eventId/feed ----
  app.get('/events/:eventId/feed', { preHandler: [app.tryAuth] }, async (request, reply) => {
    const { eventId } = eventIdParam.parse(request.params);
    const { page, perPage } = listQuerySchema.parse(request.query);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, feedEnabled: true, feedAccess: true },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
    if (!event.feedEnabled)
      return reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });

    const userId = request.user?.sub ?? null;
    const role = request.user?.role ?? 'user';
    const access = await checkFeedReadAccess(eventId, userId, role);
    if (access === 'banned')
      return reply.status(403).send({ error: 'Forbidden', message: 'Banned from feed' });
    if (access === 'forbidden')
      return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });

    // Symmetric block filter: hide people this reader blocked AND people who
    // blocked them (App Store guideline 1.2). Empty for anonymous readers.
    const blockedIds = await blockedUserIdsFor(userId);
    const where = {
      eventId,
      status: 'visible' as const,
      // OR with `authorUserId: null` is load-bearing: SQL `NULL NOT IN (...)`
      // evaluates to NULL, so a bare notIn silently drops every post whose
      // author deleted their account (the FK is onDelete: SetNull). Without
      // this, anyone holding a single block loses all tombstoned-author posts
      // in every event, and `total` is wrong the same way.
      ...(blockedIds.length > 0
        ? { OR: [{ authorUserId: null }, { authorUserId: { notIn: blockedIds } }] }
        : {}),
    };
    const [total, posts] = await Promise.all([
      prisma.feedPost.count({ where }),
      prisma.feedPost.findMany({
        where,
        select: POST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    let myReactions = new Map<string, string>();
    if (userId && posts.length > 0) {
      const reactions = await prisma.feedReaction.findMany({
        where: { postId: { in: posts.map((p) => p.id) }, userId },
        select: { postId: true, kind: true },
      });
      myReactions = new Map(reactions.map((r) => [r.postId, r.kind]));
    }

    const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);

    return reply.status(200).send(
      feedListResponseSchema.parse({
        posts: posts.map((p) =>
          feedPostResponseSchema.parse({
            id: p.id,
            eventId: p.eventId,
            isOwn: userId !== null && p.authorUserId === userId,
            car: serializeCarProfile(p.car, buildUrl),
            body: p.body,
            status: p.status,
            photos: [...p.photos]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((ph) => ({
                id: ph.id,
                url: buildUrl(ph.objectKey),
                width: ph.width,
                height: ph.height,
                sortOrder: ph.sortOrder,
              })),
            reactions: { likes: p._count.reactions, mine: myReactions.get(p.id) === 'like' },
            commentCount: p._count.comments,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
          }),
        ),
        page,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / perPage),
      }),
    );
  });

  // ---- GET /events/:eventId/feed/:postId/comments ----
  app.get(
    '/events/:eventId/feed/:postId/comments',
    { preHandler: [app.tryAuth] },
    async (request, reply) => {
      const { eventId, postId } = postIdParam.parse(request.params);
      const { page, perPage } = listQuerySchema.parse(request.query);

      const userId = request.user?.sub ?? null;
      const role = request.user?.role ?? 'user';

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { feedEnabled: true },
      });
      if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
      if (!event.feedEnabled)
        return reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });

      const post = await prisma.feedPost.findFirst({
        where: { id: postId, eventId, status: 'visible' },
        select: { id: true },
      });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

      const access = await checkFeedReadAccess(eventId, userId, role);
      if (access !== 'ok')
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });

      const blockedIds = await blockedUserIdsFor(userId);
      const where = {
        postId,
        status: 'visible' as const,
        // Same NULL semantics as the post list above.
        ...(blockedIds.length > 0
          ? { OR: [{ authorUserId: null }, { authorUserId: { notIn: blockedIds } }] }
          : {}),
      };
      const [total, comments] = await Promise.all([
        prisma.feedComment.count({ where }),
        prisma.feedComment.findMany({
          where,
          select: {
            id: true,
            postId: true,
            body: true,
            status: true,
            authorUserId: true,
            createdAt: true,
            updatedAt: true,
            car: { select: CAR_SELECT },
          },
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
      ]);

      const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);
      return reply.status(200).send(
        feedCommentListResponseSchema.parse({
          comments: comments.map((c) =>
            feedCommentResponseSchema.parse({
              id: c.id,
              postId: c.postId,
              isOwn: userId !== null && c.authorUserId === userId,
              car: serializeCarProfile(c.car, buildUrl),
              body: c.body,
              status: c.status,
              createdAt: c.createdAt.toISOString(),
              updatedAt: c.updatedAt.toISOString(),
            }),
          ),
          page,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / perPage),
        }),
      );
    },
  );

  // ---- Rate-limited feed write endpoints (30/min per user) ----
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const user = request.user as { sub: string } | undefined;
        return `feed-write:${user?.sub ?? request.ip}`;
      },
    });

    // ---- POST /events/:eventId/feed ----
    scoped.post('/events/:eventId/feed', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId } = eventIdParam.parse(request.params);

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { feedEnabled: true },
      });
      if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
      if (!event.feedEnabled)
        return reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });

      const access = await checkFeedPostAccess(eventId, sub, role);
      if (access === 'banned')
        return reply.status(403).send({ error: 'Forbidden', message: 'Banned from posting' });
      if (access === 'forbidden')
        return reply.status(403).send({ error: 'Forbidden', message: 'Posting access denied' });

      const { carId, body, photoObjectKeys } = feedPostCreateInputSchema.parse(request.body);

      if (photoObjectKeys?.length) {
        for (const key of photoObjectKeys) {
          if (!app.uploads.isOwnedKey(key, sub, 'feed_photo')) {
            return reply
              .status(403)
              .send({ error: 'Forbidden', message: 'Photo does not belong to you' });
          }
        }
      }

      if (carId) {
        const car = await prisma.car.findFirst({
          where: { id: carId, userId: sub },
          select: { id: true },
        });
        if (!car)
          return reply
            .status(403)
            .send({ error: 'Forbidden', message: 'Car does not belong to you' });
      }

      const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);

      // Wrap the post create + Conquistas eligibility/award in a single
      // tx so the badge grant is atomic with the post itself. Without the
      // tx wrap a crash between the create and the award would leave the
      // post but miss the badge (or vice versa on rollback).
      const post = await prisma.$transaction(async (tx) => {
        const created = await tx.feedPost.create({
          data: {
            eventId,
            authorUserId: sub,
            carId: carId ?? null,
            body,
            status: 'visible',
            ...(photoObjectKeys?.length && {
              photos: {
                create: photoObjectKeys.map((key, i) => ({ objectKey: key, sortOrder: i })),
              },
            }),
          },
          select: POST_SELECT,
        });

        const garage = await tx.garage.findUnique({
          where: { userId: sub },
          select: { id: true },
        });
        if (garage) {
          const codes = await checkFeedEligibility(tx, sub, created.id);
          for (const code of codes) {
            try {
              await awardBadge(tx, garage.id, code, `feed_post:${created.id}`);
            } catch (err) {
              app.log.warn(
                { err, garageId: garage.id, code },
                'awardBadge failed during feed post create',
              );
            }
          }
          await awardXp(tx, garage.id, 'post_create', {
            sourceRef: `post:${created.id}`,
          });
        }
        return created;
      });

      return reply.status(201).send(
        feedPostResponseSchema.parse({
          id: post.id,
          eventId: post.eventId,
          // Create: the author is the caller by construction.
          isOwn: true,
          car: serializeCarProfile(post.car, buildUrl),
          body: post.body,
          status: post.status,
          photos: [...post.photos]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((ph) => ({
              id: ph.id,
              url: buildUrl(ph.objectKey),
              width: ph.width,
              height: ph.height,
              sortOrder: ph.sortOrder,
            })),
          reactions: { likes: 0, mine: false },
          commentCount: 0,
          createdAt: post.createdAt.toISOString(),
          updatedAt: post.updatedAt.toISOString(),
        }),
      );
    });

    // ---- PATCH /events/:eventId/feed/:postId ----
    scoped.patch('/events/:eventId/feed/:postId', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, postId } = postIdParam.parse(request.params);

      const parseResult = feedPostPatchInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: parseResult.error.errors[0]?.message ?? 'Invalid input',
        });
      }
      const patch = parseResult.data;

      const post = await prisma.feedPost.findFirst({ where: { id: postId, eventId } });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

      if (await isFeedBanned(eventId, sub))
        return reply.status(403).send({ error: 'Forbidden', message: 'Banned from posting' });

      const isStaff = role === 'organizer' || role === 'admin';
      if (!isStaff && post.authorUserId !== sub) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Not the post author' });
      }

      if (patch.photoObjectKeys?.length) {
        for (const key of patch.photoObjectKeys) {
          if (!app.uploads.isOwnedKey(key, sub, 'feed_photo')) {
            return reply
              .status(403)
              .send({ error: 'Forbidden', message: 'Photo does not belong to you' });
          }
        }
      }

      if (patch.photoObjectKeys !== undefined) {
        const existingPhotos = await prisma.feedPostPhoto.findMany({
          where: { postId },
          select: { objectKey: true },
        });
        await prisma.feedPostPhoto.deleteMany({ where: { postId } });
        for (const photo of existingPhotos) {
          try {
            await queueObjectDeletion({
              objectKey: photo.objectKey,
              reason: 'feed_photo_replaced',
            });
          } catch (err) {
            app.log.warn(
              { err, objectKey: photo.objectKey, postId },
              'failed to queue replaced feed photo object for deletion',
            );
          }
        }
      }

      const updated = await prisma.feedPost.update({
        where: { id: postId },
        data: {
          ...(patch.body !== undefined && { body: patch.body }),
          ...(patch.photoObjectKeys !== undefined && {
            photos: {
              create: patch.photoObjectKeys.map((key, i) => ({ objectKey: key, sortOrder: i })),
            },
          }),
        },
        select: POST_SELECT,
      });

      const myReaction = await prisma.feedReaction.findUnique({
        where: { postId_userId: { postId, userId: sub } },
        select: { kind: true },
      });
      const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);

      return reply.status(200).send(
        feedPostResponseSchema.parse({
          id: updated.id,
          eventId: updated.eventId,
          // Patch: only the author or a moderator reaches here; the moderator
          // case is corrected below.
          isOwn: updated.authorUserId === sub,
          car: serializeCarProfile(updated.car, buildUrl),
          body: updated.body,
          status: updated.status,
          photos: [...updated.photos]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((ph) => ({
              id: ph.id,
              url: buildUrl(ph.objectKey),
              width: ph.width,
              height: ph.height,
              sortOrder: ph.sortOrder,
            })),
          reactions: { likes: updated._count.reactions, mine: myReaction?.kind === 'like' },
          commentCount: updated._count.comments,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        }),
      );
    });

    // ---- DELETE /events/:eventId/feed/:postId ----
    scoped.delete('/events/:eventId/feed/:postId', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, postId } = postIdParam.parse(request.params);

      const post = await prisma.feedPost.findFirst({
        where: { id: postId, eventId },
        include: { photos: { select: { objectKey: true } } },
      });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

      if (await isFeedBanned(eventId, sub))
        return reply.status(403).send({ error: 'Forbidden', message: 'Banned from posting' });

      const isStaff = role === 'organizer' || role === 'admin';
      if (!isStaff && post.authorUserId !== sub) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Not the post author' });
      }

      for (const photo of post.photos) {
        try {
          await queueObjectDeletion({ objectKey: photo.objectKey, reason: 'feed_post_removed' });
        } catch (err) {
          app.log.warn(
            { err, objectKey: photo.objectKey, postId },
            'failed to queue removed feed post photo for deletion',
          );
        }
      }

      await prisma.feedPost.update({
        where: { id: postId },
        data: { status: 'removed', hiddenAt: new Date(), hiddenById: sub },
      });
      return reply.status(204).send();
    });

    // ---- POST /events/:eventId/feed/:postId/comments ----
    scoped.post('/events/:eventId/feed/:postId/comments', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, postId } = postIdParam.parse(request.params);

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { feedEnabled: true },
      });
      if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
      if (!event.feedEnabled)
        return reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });

      const post = await prisma.feedPost.findFirst({
        where: { id: postId, eventId, status: 'visible' },
        select: { id: true, authorUserId: true },
      });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

      const access = await checkFeedPostAccess(eventId, sub, role);
      if (access === 'banned')
        return reply.status(403).send({ error: 'Forbidden', message: 'Banned from posting' });
      if (access === 'forbidden')
        return reply.status(403).send({ error: 'Forbidden', message: 'Posting access denied' });

      // A block has to stop writing, not just reading. Hiding the thread from the
      // victim while everyone else still sees the comment is not a block.
      if (await isBlockedBetween(sub, post.authorUserId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Blocked' });
      }

      const { carId, body } = feedCommentCreateInputSchema.parse(request.body);

      if (carId) {
        const car = await prisma.car.findFirst({
          where: { id: carId, userId: sub },
          select: { id: true },
        });
        if (!car)
          return reply
            .status(403)
            .send({ error: 'Forbidden', message: 'Car does not belong to you' });
      }

      const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);

      const comment = await prisma.feedComment.create({
        data: { postId, authorUserId: sub, carId: carId ?? null, body, status: 'visible' },
        select: {
          id: true,
          postId: true,
          body: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          car: { select: CAR_SELECT },
        },
      });

      return reply.status(201).send(
        feedCommentResponseSchema.parse({
          id: comment.id,
          postId: comment.postId,
          // Create: the author is the caller by construction.
          isOwn: true,
          car: serializeCarProfile(comment.car, buildUrl),
          body: comment.body,
          status: comment.status,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
        }),
      );
    });

    // ---- DELETE /events/:eventId/feed/comments/:commentId ----
    scoped.delete('/events/:eventId/feed/comments/:commentId', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, commentId } = commentIdParam.parse(request.params);

      const comment = await prisma.feedComment.findFirst({
        where: { id: commentId, post: { eventId } },
        select: { id: true, authorUserId: true },
      });
      if (!comment)
        return reply.status(404).send({ error: 'NotFound', message: 'Comment not found' });

      if (await isFeedBanned(eventId, sub))
        return reply.status(403).send({ error: 'Forbidden', message: 'Banned from posting' });

      const isStaff = role === 'organizer' || role === 'admin';
      if (!isStaff && comment.authorUserId !== sub) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Not the comment author' });
      }

      await prisma.feedComment.delete({ where: { id: commentId } });
      return reply.status(204).send();
    });

    /**
     * Gate shared by report and block-author.
     *
     * These three routes shipped with NO authorization beyond authentication:
     * every neighbour in this scope runs `feedEnabled` plus
     * checkFeedPostAccess/checkFeedReadAccess plus isFeedBanned, and the new
     * ones ran only an existence check. Adversarial review proved the
     * consequence with probes: an outsider with no ticket could report on a
     * members-only feed, a user banned from the feed could report, and three
     * throwaway accounts could push any post past the auto-hide threshold.
     *
     * Email verification is required on top, because signup returns a working
     * access token with `emailVerifiedAt` null and each new email opens its own
     * rate-limit bucket — so unverified accounts are free and unlimited, which
     * is exactly the wrong cost model for something that hides other people's
     * content.
     */
    const gateFeedModerationAction = async (
      eventId: string,
      userId: string,
      role: 'user' | 'organizer' | 'admin' | 'staff',
      reply: {
        status: (n: number) => { send: (b: unknown) => unknown };
      },
    ): Promise<boolean> => {
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { feedEnabled: true },
      });
      if (!event) {
        reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
        return true;
      }
      if (!event.feedEnabled) {
        reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });
        return true;
      }

      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      if (!actor?.emailVerifiedAt) {
        reply.status(403).send({ error: 'Forbidden', message: 'Verify your email first' });
        return true;
      }

      const access = await checkFeedReadAccess(eventId, userId, role);
      if (access === 'banned') {
        reply.status(403).send({ error: 'Forbidden', message: 'Banned from feed' });
        return true;
      }
      if (access === 'forbidden') {
        reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
        return true;
      }
      if (await isFeedBanned(eventId, userId)) {
        reply.status(403).send({ error: 'Forbidden', message: 'Banned from feed' });
        return true;
      }

      return false;
    };

    // ---- PUT /events/:eventId/feed/:postId/block-author ----
    // Blocking is by POST, not by user id, on purpose: the feed payload does not
    // expose authorUserId and adding it would put a new user identifier into a
    // contract shared with admin and web. The server resolves the author here
    // instead. PUT because blocking twice is a no-op, not an error.
    scoped.put('/events/:eventId/feed/:postId/block-author', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, postId } = postIdParam.parse(request.params);

      if (await gateFeedModerationAction(eventId, sub, role, reply)) return reply;

      const post = await prisma.feedPost.findFirst({
        where: { id: postId, eventId },
        select: { authorUserId: true },
      });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });
      if (!post.authorUserId) {
        // Author deleted their account (onDelete: SetNull). Nothing to block.
        return reply.status(409).send({ error: 'Conflict', message: 'post has no author' });
      }
      if (post.authorUserId === sub) {
        return reply
          .status(422)
          .send({ error: 'UnprocessableEntity', message: 'cannot block yourself' });
      }

      try {
        await prisma.userBlock.create({ data: { blockerId: sub, blockedId: post.authorUserId } });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
      }

      return reply.status(204).send();
    });

    // ---- POST /events/:eventId/feed/:postId/report ----
    // App Store guideline 1.2 requires users to be able to report objectionable
    // content. The Report model already existed; nothing ever created a row.
    scoped.post('/events/:eventId/feed/:postId/report', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, postId } = postIdParam.parse(request.params);

      if (await gateFeedModerationAction(eventId, sub, role, reply)) return reply;

      const parsed = reportCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const post = await prisma.feedPost.findFirst({
        where: { id: postId, eventId },
        select: { id: true },
      });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

      const result = await fileReport({
        target: { kind: 'post', postId },
        reporterUserId: sub,
        reason: parsed.data.reason,
      });

      return reply
        .status(result.created ? 201 : 200)
        .send({ reported: true, autoHidden: result.autoHidden });
    });

    // ---- POST /events/:eventId/feed/comments/:commentId/report ----
    scoped.post('/events/:eventId/feed/comments/:commentId/report', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, commentId } = commentIdParam.parse(request.params);

      if (await gateFeedModerationAction(eventId, sub, role, reply)) return reply;

      const parsed = reportCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const comment = await prisma.feedComment.findFirst({
        where: { id: commentId, post: { eventId } },
        select: { id: true },
      });
      if (!comment)
        return reply.status(404).send({ error: 'NotFound', message: 'Comment not found' });

      const result = await fileReport({
        target: { kind: 'comment', commentId },
        reporterUserId: sub,
        reason: parsed.data.reason,
      });

      return reply
        .status(result.created ? 201 : 200)
        .send({ reported: true, autoHidden: result.autoHidden });
    });

    // ---- POST /events/:eventId/feed/:postId/reactions ----
    scoped.post('/events/:eventId/feed/:postId/reactions', {}, async (request, reply) => {
      const { sub, role } = requireUser(request);
      const { eventId, postId } = postIdParam.parse(request.params);
      const { kind } = feedReactionInputSchema.parse(request.body);

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { feedEnabled: true },
      });
      if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
      if (!event.feedEnabled)
        return reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });

      const access = await checkFeedReadAccess(eventId, sub, role);
      if (access === 'banned')
        return reply.status(403).send({ error: 'Forbidden', message: 'Banned from feed' });
      if (access === 'forbidden')
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });

      const post = await prisma.feedPost.findFirst({
        where: { id: postId, eventId, status: 'visible' },
        select: { id: true, authorUserId: true },
      });
      if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

      // Same reasoning as the comment path: a block must stop the interaction,
      // not merely hide it from the person who asked for the block.
      if (await isBlockedBetween(sub, post.authorUserId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Blocked' });
      }

      const where = { postId_userId: { postId, userId: sub } };

      // Resolve the author's garageId once — used for both apply and revert paths.
      // Outside the tx: this is a read-only lookup that does not mutate state.
      // If the author has been tombstoned (authorUserId === null) OR has no garage,
      // skip awarder entirely. The reaction still lands.
      let authorGarageId: string | null = null;
      if (post.authorUserId) {
        const g = await prisma.garage.findUnique({
          where: { userId: post.authorUserId },
          select: { id: true },
        });
        authorGarageId = g?.id ?? null;
      }

      await prisma.$transaction(async (tx) => {
        // Read existing row first. Inside an interactive $transaction, a P2002
        // from create() aborts the entire Postgres tx (state 25P02). A bare
        // try/catch around the create is not enough — we wrap it in a SAVEPOINT
        // so a concurrent first-like (the race covered by feed/crud.test.ts
        // 'concurrent first likes do not 500') can recover and replay the row
        // as the existing-row branch instead.
        const prior = await tx.feedReaction.findUnique({
          where,
          select: { id: true, kind: true },
        });

        let prevKind: string | null = null;
        let nextKind: string | null = null;
        let reactionId: string | null = null;

        if (!prior) {
          // Path A: no prior row → create. Guard with a savepoint so a
          // concurrent peer insert (P2002) does not poison the parent tx.
          // On P2002 the peer won the race for the row; we replay the
          // existing-row branch (B/C) on top of the peer's row so the
          // current request's intended (postId, userId, kind) transition
          // still applies, instead of silently dropping it. Awarder
          // dispatch then fires naturally on the resulting (prevKind,
          // nextKind) at the end of this callback.
          await tx.$executeRawUnsafe('SAVEPOINT reaction_create');
          try {
            const row = await tx.feedReaction.create({
              data: { postId, userId: sub, kind },
              select: { id: true },
            });
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT reaction_create');
            prevKind = null;
            nextKind = kind;
            reactionId = row.id;
          } catch (err) {
            if (!isUniqueConstraintError(err)) throw err;
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT reaction_create');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT reaction_create');
            // Race lost — a concurrent peer wrote the row first. Re-read and
            // replay the existing-row branch so the current request's
            // intended transition still applies on top of the peer's row
            // instead of silently dropping. The awarder dispatch below then
            // fires on the resulting (prevKind, nextKind) just like a normal
            // existing-row path.
            const peer = await tx.feedReaction.findUnique({
              where,
              select: { id: true, kind: true },
            });
            if (!peer) return; // peer was deleted in a third race — bail cleanly
            reactionId = peer.id;
            prevKind = peer.kind;
            if (peer.kind === kind) {
              await tx.feedReaction.delete({ where });
              nextKind = null;
            } else {
              await tx.feedReaction.update({ where, data: { kind } });
              nextKind = kind;
            }
          }
        } else {
          reactionId = prior.id;
          prevKind = prior.kind;
          if (prior.kind === kind) {
            // Path B: same kind → toggle off (delete).
            await tx.feedReaction.delete({ where });
            nextKind = null;
          } else {
            // Path C: different kind → flip.
            await tx.feedReaction.update({ where, data: { kind } });
            nextKind = kind;
          }
        }

        // Awarder dispatch. No local try/catch (canon §5): the awarder swallows
        // expected P2002 + killswitch internally; any other throw rolls back the
        // entire reaction transaction (route surfaces 500). Both calls are no-ops
        // when authorGarageId is null (tombstoned author or author has no garage).
        if (!authorGarageId || !reactionId) return;
        const sourceRef = `post:${postId}:reaction:${reactionId}`;

        if (prevKind !== 'like' && nextKind === 'like') {
          await awardXp(tx, authorGarageId, 'post_like', { sourceRef });
        } else if (prevKind === 'like' && nextKind !== 'like') {
          await revertLikeXp(tx, postId, reactionId, authorGarageId);
        }
        // All other (prevKind, nextKind) pairs: no XP movement.
      });

      const [likes, mine] = await Promise.all([
        prisma.feedReaction.count({ where: { postId, kind: 'like' } }),
        prisma.feedReaction.findUnique({
          where,
          select: { kind: true },
        }),
      ]);

      const result = { likes, mine: mine?.kind === 'like' };

      return reply.status(200).send(result);
    });
  });
};
