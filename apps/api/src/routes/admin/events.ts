import { prisma } from '@jdm/db';
import {
  adminEventCreateSchema,
  adminEventDetailSchema,
  adminEventUpdateSchema,
} from '@jdm/shared/admin';
import { eventExtraPublicSchema } from '@jdm/shared/extras';
import {
  computeCapacityDisplay,
  defaultCapacityDisplaySurfaceSetting,
} from '@jdm/shared/general-settings';
import type {
  Event as DbEvent,
  TicketExtra as DbExtra,
  TicketTier as DbTier,
  Prisma,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { displayPriceCents } from '../../services/pricing/dev-fee.js';
import type { Uploads } from '../../services/uploads/index.js';
import { runPremiumEventPublishGrant } from '../../workers/premium-event-publish-grant.js';

import { serializeAdminTier } from './serializers.js';

const adminExtraCapacityDisplay = (x: DbExtra) => {
  if (x.quantityTotal == null) {
    return computeCapacityDisplay(
      { status: 'available', remaining: null, total: null },
      defaultCapacityDisplaySurfaceSetting,
    );
  }
  const remaining = Math.max(0, x.quantityTotal - x.quantitySold);
  const status = remaining === 0 ? 'sold_out' : 'available';
  return computeCapacityDisplay(
    { status, remaining, total: x.quantityTotal },
    defaultCapacityDisplaySurfaceSetting,
  );
};

const serializeExtra = (x: DbExtra, devFeePercent: number) =>
  eventExtraPublicSchema.parse({
    id: x.id,
    name: x.name,
    description: x.description,
    priceCents: x.priceCents,
    displayPriceCents: displayPriceCents(x.priceCents, devFeePercent),
    devFeePercent,
    currency: x.currency,
    quantityRemaining:
      x.quantityTotal != null ? Math.max(0, x.quantityTotal - x.quantitySold) : null,
    sortOrder: x.sortOrder,
    capacityDisplay: adminExtraCapacityDisplay(x),
  });

const serializeDetail = (
  e: DbEvent & { tiers: DbTier[]; extras: DbExtra[] },
  uploads: Uploads,
  devFeePercent: number,
) =>
  adminEventDetailSchema.parse({
    id: e.id,
    slug: e.slug,
    title: e.title,
    coverUrl: e.coverObjectKey ? uploads.buildPublicUrl(e.coverObjectKey) : null,
    coverObjectKey: e.coverObjectKey,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    city: e.city,
    stateCode: e.stateCode,
    type: e.type,
    description: e.description,
    capacity: e.capacity,
    maxTicketsPerUser: e.maxTicketsPerUser,
    hasCarTier: e.tiers.some((t) => t.requiresCar),
    feedEnabled: e.feedEnabled,
    feedAccess: e.feedAccess,
    postingAccess: e.postingAccess,
    maxPostsPerUser: e.maxPostsPerUser,
    maxPhotosPerUser: e.maxPhotosPerUser,
    status: e.status,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    tiers: e.tiers
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => serializeAdminTier(t, devFeePercent)),
    extras: e.extras
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => serializeExtra(x, devFeePercent)),
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const adminEventRoutes: FastifyPluginAsync = async (app) => {
  app.post('/events', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = adminEventCreateSchema.parse(request.body);
    try {
      const event = await prisma.event.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          coverObjectKey: input.coverObjectKey,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          venueName: input.venueName,
          venueAddress: input.venueAddress,
          city: input.city,
          stateCode: input.stateCode,
          type: input.type,
          capacity: input.capacity,
          maxTicketsPerUser: input.maxTicketsPerUser,
          feedEnabled: input.feedEnabled,
          feedAccess: input.feedAccess,
          postingAccess: input.postingAccess,
          maxPostsPerUser: input.maxPostsPerUser,
          maxPhotosPerUser: input.maxPhotosPerUser,
          status: 'draft',
        },
        include: { tiers: true, extras: true },
      });
      await recordAudit({
        actorId: sub,
        action: 'event.create',
        entityType: 'event',
        entityId: event.id,
        metadata: { slug: event.slug },
      });
      return reply.status(201).send(serializeDetail(event, app.uploads, app.env.DEV_FEE_PERCENT));
    } catch (e) {
      const err = e as Prisma.PrismaClientKnownRequestError;
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'slug already exists' });
      }
      throw e;
    }
  });

  app.get('/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id },
      include: { tiers: true, extras: true },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound' });
    return serializeDetail(event, app.uploads, app.env.DEV_FEE_PERCENT);
  });

  app.patch('/events/:id', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminEventUpdateSchema.parse(request.body);

    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.EventUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.coverObjectKey !== undefined) data.coverObjectKey = input.coverObjectKey;
    if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined) data.endsAt = new Date(input.endsAt);
    if (input.venueName !== undefined) data.venueName = input.venueName;
    if (input.venueAddress !== undefined) data.venueAddress = input.venueAddress;
    if (input.city !== undefined) data.city = input.city;
    if (input.stateCode !== undefined) data.stateCode = input.stateCode;
    if (input.type !== undefined) data.type = input.type;
    if (input.capacity !== undefined) data.capacity = input.capacity;
    if (input.maxTicketsPerUser !== undefined) data.maxTicketsPerUser = input.maxTicketsPerUser;
    if (input.feedEnabled !== undefined) data.feedEnabled = input.feedEnabled;
    if (input.feedAccess !== undefined) data.feedAccess = input.feedAccess;
    if (input.postingAccess !== undefined) data.postingAccess = input.postingAccess;
    if (input.maxPostsPerUser !== undefined) data.maxPostsPerUser = input.maxPostsPerUser;
    if (input.maxPhotosPerUser !== undefined) data.maxPhotosPerUser = input.maxPhotosPerUser;

    const updated = await prisma.event.update({
      where: { id },
      data,
      include: { tiers: true, extras: true },
    });
    await recordAudit({
      actorId: sub,
      action: 'event.update',
      entityType: 'event',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return serializeDetail(updated, app.uploads, app.env.DEV_FEE_PERCENT);
  });

  app.post('/events/:id/publish', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    if (existing.status === 'published') {
      return reply.status(409).send({ error: 'Conflict', message: 'already published' });
    }
    if (!existing.coverObjectKey) {
      return reply
        .status(409)
        .send({ error: 'Conflict', message: 'adicione uma capa antes de publicar' });
    }
    const updated = await prisma.event.update({
      where: { id },
      data: {
        status: 'published',
        publishedAt: new Date(),
      },
      include: { tiers: true, extras: true },
    });
    await recordAudit({
      actorId: sub,
      action: 'event.publish',
      entityType: 'event',
      entityId: id,
    });

    // Post-commit: enqueue the premium-grant job (spec §4.6, canon §F8.4).
    // The publish tx (prisma.event.update above) is already committed before
    // this line. Fire-and-forget so the HTTP response returns promptly; the
    // worker logs its own progress. Gated on the feature flag so the publish
    // path is a no-op when premium billing is off.
    if (app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      void runPremiumEventPublishGrant({
        eventId: id,
        publishedAt: updated.publishedAt ?? new Date(),
        log: request.log,
      }).catch((err: unknown) => {
        request.log.error({ err, eventId: id }, 'premium-event-publish-grant: job failed');
      });
    }

    return serializeDetail(updated, app.uploads, app.env.DEV_FEE_PERCENT);
  });

  app.post('/events/:id/unpublish', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    if (existing.status !== 'published') {
      return reply.status(409).send({
        error: 'Conflict',
        message:
          existing.status === 'draft'
            ? 'already draft'
            : 'only published events can be unpublished',
      });
    }
    const updated = await prisma.event.update({
      where: { id },
      data: {
        status: 'draft',
        publishedAt: null,
      },
      include: { tiers: true, extras: true },
    });
    await recordAudit({
      actorId: sub,
      action: 'event.unpublish',
      entityType: 'event',
      entityId: id,
    });
    return serializeDetail(updated, app.uploads, app.env.DEV_FEE_PERCENT);
  });

  app.post('/events/:id/cancel', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    if (existing.status === 'cancelled') {
      return reply.status(409).send({ error: 'Conflict', message: 'already cancelled' });
    }
    const updated = await prisma.event.update({
      where: { id },
      data: { status: 'cancelled' },
      include: { tiers: true, extras: true },
    });
    await recordAudit({
      actorId: sub,
      action: 'event.cancel',
      entityType: 'event',
      entityId: id,
    });
    return serializeDetail(updated, app.uploads, app.env.DEV_FEE_PERCENT);
  });

  app.get('/events', async () => {
    const events = await prisma.event.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        type: true,
        startsAt: true,
        endsAt: true,
        city: true,
        stateCode: true,
        capacity: true,
        publishedAt: true,
        createdAt: true,
      },
    });
    return {
      items: events.map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        status: e.status,
        type: e.type,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        city: e.city,
        stateCode: e.stateCode,
        capacity: e.capacity,
        publishedAt: e.publishedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  });
};
