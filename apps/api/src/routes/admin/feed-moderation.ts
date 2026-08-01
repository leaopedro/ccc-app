import { prisma } from '@ccc/db';
import {
  createFeedBanInputSchema,
  moderateCommentInputSchema,
  moderatePostInputSchema,
  resolveReportInputSchema,
} from '@ccc/shared/feed';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { computeIsPremiumActive } from '../../services/garage/index.js';

const eventIdParam = z.object({ eventId: z.string().min(1) });
const postIdParam = z.object({ eventId: z.string().min(1), postId: z.string().min(1) });
const commentIdParam = z.object({ eventId: z.string().min(1), commentId: z.string().min(1) });
const reportIdParam = z.object({ eventId: z.string().min(1), reportId: z.string().min(1) });
const banIdParam = z.object({ eventId: z.string().min(1), banId: z.string().min(1) });

const STATUS_MAP = { hide: 'hidden', remove: 'removed', restore: 'visible' } as const;
const AUDIT_POST_MAP = {
  hide: 'feed.post.hide',
  remove: 'feed.post.remove',
  restore: 'feed.post.restore',
} as const;
const AUDIT_COMMENT_MAP = {
  hide: 'feed.comment.hide',
  remove: 'feed.comment.remove',
  restore: 'feed.comment.restore',
} as const;

// eslint-disable-next-line @typescript-eslint/require-await
export const adminFeedModerationRoutes: FastifyPluginAsync = async (app) => {
  // ---- Post moderation ----
  app.post('/events/:eventId/feed/posts/:postId/moderate', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, postId } = postIdParam.parse(request.params);
    const { action } = moderatePostInputSchema.parse(request.body);

    const post = await prisma.feedPost.findFirst({ where: { id: postId, eventId } });
    if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

    const newStatus = STATUS_MAP[action];
    const isRestore = action === 'restore';

    await prisma.feedPost.update({
      where: { id: postId },
      data: {
        status: newStatus,
        hiddenAt: isRestore ? null : new Date(),
        hiddenById: isRestore ? null : sub,
      },
    });

    await recordAudit({
      actorId: sub,
      action: AUDIT_POST_MAP[action],
      entityType: 'feed_post',
      entityId: postId,
      metadata: { eventId, previousStatus: post.status },
    });

    return reply.status(200).send({ ok: true, status: newStatus });
  });

  // ---- Comment moderation ----
  app.post('/events/:eventId/feed/comments/:commentId/moderate', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, commentId } = commentIdParam.parse(request.params);
    const { action } = moderateCommentInputSchema.parse(request.body);

    const comment = await prisma.feedComment.findFirst({
      where: { id: commentId, post: { eventId } },
    });
    if (!comment)
      return reply.status(404).send({ error: 'NotFound', message: 'Comment not found' });

    const newStatus = STATUS_MAP[action];
    const isRestore = action === 'restore';

    await prisma.feedComment.update({
      where: { id: commentId },
      data: {
        status: newStatus,
        hiddenAt: isRestore ? null : new Date(),
        hiddenById: isRestore ? null : sub,
      },
    });

    await recordAudit({
      actorId: sub,
      action: AUDIT_COMMENT_MAP[action],
      entityType: 'feed_comment',
      entityId: commentId,
      metadata: { eventId, previousStatus: comment.status },
    });

    return reply.status(200).send({ ok: true, status: newStatus });
  });

  // ---- Report management ----
  app.get('/events/:eventId/feed/reports', async (request, reply) => {
    const { eventId } = eventIdParam.parse(request.params);
    const { status } = z
      .object({ status: z.enum(['open', 'resolved', 'dismissed']).optional() })
      .parse(request.query);

    const reports = await prisma.report.findMany({
      where: {
        status: status ?? 'open',
        OR: [{ post: { eventId } }, { comment: { post: { eventId } } }],
      },
      include: {
        reporter: { select: { name: true } },
        resolver: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const items = reports.map((r) => ({
      id: r.id,
      targetKind: r.targetKind,
      targetId: r.postId ?? r.commentId ?? '',
      reporterName: r.reporter?.name ?? null,
      reason: r.reason,
      status: r.status,
      resolution: r.resolution,
      resolverName: r.resolver?.name ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return reply.send({ reports: items });
  });

  app.post('/events/:eventId/feed/reports/:reportId/resolve', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, reportId } = reportIdParam.parse(request.params);
    const { resolution } = resolveReportInputSchema.parse(request.body);

    const report = await prisma.report.findFirst({
      where: {
        id: reportId,
        OR: [{ post: { eventId } }, { comment: { post: { eventId } } }],
      },
    });
    if (!report) return reply.status(404).send({ error: 'NotFound', message: 'Report not found' });
    if (report.status !== 'open')
      return reply.status(409).send({ error: 'Conflict', message: 'Report is not open' });

    await prisma.report.update({
      where: { id: reportId },
      data: { status: 'resolved', resolverId: sub, resolution, resolvedAt: new Date() },
    });

    await recordAudit({
      actorId: sub,
      action: 'feed.report.resolve',
      entityType: 'report',
      entityId: reportId,
      metadata: { eventId },
    });

    return reply.status(200).send({ ok: true });
  });

  app.post('/events/:eventId/feed/reports/:reportId/dismiss', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, reportId } = reportIdParam.parse(request.params);

    const report = await prisma.report.findFirst({
      where: {
        id: reportId,
        OR: [{ post: { eventId } }, { comment: { post: { eventId } } }],
      },
    });
    if (!report) return reply.status(404).send({ error: 'NotFound', message: 'Report not found' });
    if (report.status !== 'open')
      return reply.status(409).send({ error: 'Conflict', message: 'Report is not open' });

    await prisma.report.update({
      where: { id: reportId },
      data: { status: 'dismissed', resolverId: sub, resolvedAt: new Date() },
    });

    await recordAudit({
      actorId: sub,
      action: 'feed.report.dismiss',
      entityType: 'report',
      entityId: reportId,
      metadata: { eventId },
    });

    return reply.status(200).send({ ok: true });
  });

  // ---- Ban management ----
  app.get('/events/:eventId/feed/bans', async (request, reply) => {
    const { eventId } = eventIdParam.parse(request.params);

    const bans = await prisma.feedBan.findMany({
      where: { eventId },
      include: {
        user: { select: { name: true } },
        bannedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items = bans.map((b) => ({
      id: b.id,
      eventId: b.eventId,
      userId: b.userId,
      userName: b.user.name,
      scope: b.scope,
      reason: b.reason,
      bannedByName: b.bannedBy.name,
      createdAt: b.createdAt.toISOString(),
    }));

    return reply.send({ bans: items });
  });

  app.post('/events/:eventId/feed/bans', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId } = eventIdParam.parse(request.params);
    const input = createFeedBanInputSchema.parse(request.body);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });

    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) return reply.status(404).send({ error: 'NotFound', message: 'User not found' });

    const existing = await prisma.feedBan.findUnique({
      where: { eventId_userId_scope: { eventId, userId: input.userId, scope: input.scope } },
    });
    if (existing)
      return reply.status(409).send({ error: 'Conflict', message: 'Ban already exists' });

    const ban = await prisma.feedBan.create({
      data: {
        eventId,
        userId: input.userId,
        scope: input.scope,
        reason: input.reason ?? null,
        bannedById: sub,
      },
    });

    await recordAudit({
      actorId: sub,
      action: 'feed.ban.create',
      entityType: 'feed_ban',
      entityId: ban.id,
      metadata: { eventId, userId: input.userId, scope: input.scope },
    });

    return reply.status(201).send({ id: ban.id, scope: ban.scope });
  });

  app.delete('/events/:eventId/feed/bans/:banId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, banId } = banIdParam.parse(request.params);

    const ban = await prisma.feedBan.findFirst({ where: { id: banId, eventId } });
    if (!ban) return reply.status(404).send({ error: 'NotFound', message: 'Ban not found' });

    await prisma.feedBan.delete({ where: { id: banId } });

    await recordAudit({
      actorId: sub,
      action: 'feed.ban.delete',
      entityType: 'feed_ban',
      entityId: banId,
      metadata: { eventId, userId: ban.userId, scope: ban.scope },
    });

    return reply.status(204).send();
  });

  // ---- Moderation queue ----
  app.get('/events/:eventId/feed/queue', async (request, reply) => {
    const { eventId } = eventIdParam.parse(request.params);

    const [posts, comments] = await Promise.all([
      prisma.feedPost.findMany({
        where: {
          eventId,
          OR: [
            { status: { in: ['hidden', 'removed'] } },
            { reports: { some: { status: 'open' } } },
          ],
        },
        include: {
          author: { select: { name: true } },
          car: {
            select: {
              nickname: true,
              user: {
                select: { garage: { select: { premiumTier: true, premiumUntil: true } } },
              },
            },
          },
          _count: { select: { reports: { where: { status: 'open' } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.feedComment.findMany({
        where: {
          post: { eventId },
          OR: [
            { status: { in: ['hidden', 'removed'] } },
            { reports: { some: { status: 'open' } } },
          ],
        },
        include: {
          author: { select: { name: true } },
          car: {
            select: {
              nickname: true,
              user: {
                select: { garage: { select: { premiumTier: true, premiumUntil: true } } },
              },
            },
          },
          _count: { select: { reports: { where: { status: 'open' } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const computeFlag = (
      garage: {
        premiumTier: 'bronze' | 'silver' | 'gold' | null;
        premiumUntil: Date | null;
      } | null,
    ): boolean | null =>
      garage === null ? null : computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);

    const items = [
      ...posts.map((p) => ({
        kind: 'post' as const,
        id: p.id,
        body: p.body,
        status: p.status,
        authorName: p.author?.name ?? null,
        carNickname: p.car?.nickname ?? null,
        isPremiumActive: p.car ? computeFlag(p.car.user?.garage ?? null) : null,
        openReportCount: p._count.reports,
        createdAt: p.createdAt.toISOString(),
      })),
      ...comments.map((c) => ({
        kind: 'comment' as const,
        id: c.id,
        body: c.body,
        status: c.status,
        authorName: c.author?.name ?? null,
        carNickname: c.car?.nickname ?? null,
        isPremiumActive: c.car ? computeFlag(c.car.user?.garage ?? null) : null,
        openReportCount: c._count.reports,
        createdAt: c.createdAt.toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return reply.send({ items });
  });
};
