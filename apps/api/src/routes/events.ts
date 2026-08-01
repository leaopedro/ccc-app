import { createHash } from 'node:crypto';

import { prisma } from '@ccc/db';
import {
  confirmedCarSchema,
  confirmedCarsResponseSchema,
  eventDetailCommerceSchema,
  eventDetailPublicSchema,
  eventListQuerySchema,
  eventListResponseSchema,
  eventSummarySchema,
  ticketTierSchema,
} from '@ccc/shared/events';
import { eventExtraPublicSchema } from '@ccc/shared/extras';
import { type CapacityDisplayPolicy, computeCapacityDisplay } from '@ccc/shared/general-settings';
import type {
  Event as DbEvent,
  Prisma,
  TicketExtra as DbExtra,
  TicketTier as DbTier,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { computeIsPremiumActive } from '../services/garage/index.js';
import { loadCapacityDisplayPolicy } from '../services/general-settings.js';
import { displayPriceCents } from '../services/pricing/dev-fee.js';
import type { Uploads } from '../services/uploads/index.js';

const encodeCursor = (e: Pick<DbEvent, 'startsAt' | 'id'>): string =>
  Buffer.from(JSON.stringify({ s: e.startsAt.toISOString(), i: e.id })).toString('base64url');

const decodeCursor = (raw: string): { startsAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { s: string; i: string };
  return { startsAt: new Date(parsed.s), id: parsed.i };
};

const serializeSummary = (e: DbEvent, uploads: Uploads) =>
  eventSummarySchema.parse({
    id: e.id,
    slug: e.slug,
    title: e.title,
    coverUrl: e.coverObjectKey ? uploads.buildPublicUrl(e.coverObjectKey) : null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    venueName: e.venueName,
    city: e.city,
    stateCode: e.stateCode,
    type: e.type,
    status: e.status,
  });

const tierCapacityDisplay = (t: DbTier, policy: CapacityDisplayPolicy) => {
  const remaining = Math.max(0, t.quantityTotal - t.quantitySold);
  const status = t.quantityTotal > 0 && remaining === 0 ? 'sold_out' : 'available';
  return computeCapacityDisplay({ status, remaining, total: t.quantityTotal }, policy.tickets);
};

const extraCapacityDisplay = (x: DbExtra, policy: CapacityDisplayPolicy) => {
  if (x.quantityTotal == null) {
    return computeCapacityDisplay(
      { status: 'available', remaining: null, total: null },
      policy.extras,
    );
  }
  const remaining = Math.max(0, x.quantityTotal - x.quantitySold);
  const status = remaining === 0 ? 'sold_out' : 'available';
  return computeCapacityDisplay({ status, remaining, total: x.quantityTotal }, policy.extras);
};

const serializeTier = (t: DbTier, devFeePercent: number, policy: CapacityDisplayPolicy) =>
  ticketTierSchema.parse({
    id: t.id,
    name: t.name,
    priceCents: t.priceCents,
    displayPriceCents: displayPriceCents(t.priceCents, devFeePercent),
    devFeePercent,
    currency: t.currency,
    quantityTotal: t.quantityTotal,
    remainingCapacity: Math.max(0, t.quantityTotal - t.quantitySold),
    salesOpenAt: t.salesOpenAt?.toISOString() ?? null,
    salesCloseAt: t.salesCloseAt?.toISOString() ?? null,
    sortOrder: t.sortOrder,
    requiresCar: t.requiresCar,
    capacityDisplay: tierCapacityDisplay(t, policy),
  });

const serializeExtra = (x: DbExtra, devFeePercent: number, policy: CapacityDisplayPolicy) =>
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
    capacityDisplay: extraCapacityDisplay(x, policy),
  });

const serializePublicDetail = (
  e: DbEvent & { tiers: { requiresCar: boolean }[] },
  uploads: Uploads,
) =>
  eventDetailPublicSchema.parse({
    id: e.id,
    slug: e.slug,
    title: e.title,
    coverUrl: e.coverObjectKey ? uploads.buildPublicUrl(e.coverObjectKey) : null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    city: e.city,
    stateCode: e.stateCode,
    type: e.type,
    status: e.status,
    description: e.description,
    capacity: e.capacity,
    maxTicketsPerUser: e.maxTicketsPerUser,
    hasCarTier: e.tiers.some((t) => t.requiresCar),
    feedEnabled: e.feedEnabled,
    feedAccess: e.feedAccess,
    postingAccess: e.postingAccess,
  });

const serializeCommerceDetail = (
  e: DbEvent & { tiers: DbTier[]; extras: DbExtra[] },
  uploads: Uploads,
  devFeePercent: number,
  policy: CapacityDisplayPolicy,
) =>
  eventDetailCommerceSchema.parse({
    id: e.id,
    slug: e.slug,
    title: e.title,
    coverUrl: e.coverObjectKey ? uploads.buildPublicUrl(e.coverObjectKey) : null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    city: e.city,
    stateCode: e.stateCode,
    type: e.type,
    status: e.status,
    description: e.description,
    capacity: e.capacity,
    maxTicketsPerUser: e.maxTicketsPerUser,
    hasCarTier: e.tiers.some((t) => t.requiresCar),
    feedEnabled: e.feedEnabled,
    feedAccess: e.feedAccess,
    postingAccess: e.postingAccess,
    tiers: e.tiers
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => serializeTier(t, devFeePercent, policy)),
    extras: e.extras
      .filter((x) => x.quantityTotal == null || x.quantitySold < x.quantityTotal)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => serializeExtra(x, devFeePercent, policy)),
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events', async (request, reply) => {
    const { window, type, stateCode, city, cursor, limit } = eventListQuerySchema.parse(
      request.query,
    );
    const now = new Date();

    const where: Prisma.EventWhereInput = { status: 'published' };
    if (type) where.type = type;
    if (stateCode) where.stateCode = stateCode;
    if (city) where.city = city;
    if (window === 'upcoming') where.endsAt = { gte: now };
    else if (window === 'past') where.endsAt = { lt: now };

    const asc = window !== 'past';
    const orderBy = [{ startsAt: asc ? 'asc' : 'desc' }, { id: asc ? 'asc' : 'desc' }] as const;

    if (cursor) {
      try {
        const { startsAt, id } = decodeCursor(cursor);
        const cmp = asc ? 'gt' : 'lt';
        where.OR = [
          { startsAt: { [cmp]: startsAt } } as Prisma.EventWhereInput,
          { startsAt, id: { [cmp]: id } } as Prisma.EventWhereInput,
        ];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.event.findMany({
      where,
      orderBy: [...orderBy],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return eventListResponseSchema.parse({
      items: page.map((e) => serializeSummary(e, app.uploads)),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });

  app.get('/events/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const event = await prisma.event.findFirst({
      where: { slug, status: 'published' },
      include: { tiers: { select: { requiresCar: true } } },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound' });
    return serializePublicDetail(event, app.uploads);
  });

  app.get('/events/by-id/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await prisma.event.findFirst({
      where: { id, status: 'published' },
      include: { tiers: { select: { requiresCar: true } } },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound' });
    return serializePublicDetail(event, app.uploads);
  });

  app.get('/events/:slug/commerce', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const event = await prisma.event.findFirst({
      where: { slug, status: 'published' },
      include: {
        tiers: true,
        extras: { where: { active: true } },
      },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound' });
    const policy = await loadCapacityDisplayPolicy();
    return serializeCommerceDetail(event, app.uploads, app.env.DEV_FEE_PERCENT, policy);
  });

  app.get(
    '/events/by-id/:id/commerce',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const event = await prisma.event.findFirst({
        where: { id, status: 'published' },
        include: {
          tiers: true,
          extras: { where: { active: true } },
        },
      });
      if (!event) return reply.status(404).send({ error: 'NotFound' });
      const policy = await loadCapacityDisplayPolicy();
      return serializeCommerceDetail(event, app.uploads, app.env.DEV_FEE_PERCENT, policy);
    },
  );

  // Public confirmed cars — no auth required.
  // Returns only public car fields; plate and all internal fields are excluded at query level.
  app.get('/events/:slug/confirmed-cars', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const event = await prisma.event.findFirst({
      where: { slug, status: 'published' },
      select: { id: true },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound' });

    // Only tickets on car-required tiers with valid status contribute confirmed cars.
    const tickets = await prisma.ticket.findMany({
      where: {
        eventId: event.id,
        status: 'valid',
        tier: { requiresCar: true },
        carId: { not: null },
      },
      select: {
        carId: true,
        car: {
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
            photos: {
              select: { objectKey: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
            },
            // Owner's Garage powers isPremiumActive on the anonymized payload.
            // Premium dot on the confirmed-cars avatar; no other PII surfaced.
            user: {
              select: { garage: { select: { premiumTier: true, premiumUntil: true } } },
            },
          },
        },
      },
    });

    // Deduplicate by carId — one car may have multiple tickets (e.g. extras).
    const seen = new Set<string>();
    const cars: (typeof tickets)[number]['car'][] = [];
    for (const t of tickets) {
      if (t.car && t.carId && !seen.has(t.carId)) {
        seen.add(t.carId);
        cars.push(t.car);
      }
    }

    const items = await Promise.all(
      cars.map(async (c) => {
        const garage = c!.user?.garage ?? null;
        const isPremiumActive =
          garage === null ? false : computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
        return confirmedCarSchema.parse({
          ref: createHash('sha256').update(c!.id).digest('base64url').slice(0, 16),
          make: c!.make,
          model: c!.model,
          year: c!.year,
          photoUrl: c!.photos[0]?.objectKey
            ? await app.uploads.presignGet(c!.photos[0].objectKey)
            : null,
          isPremiumActive,
        });
      }),
    );

    return confirmedCarsResponseSchema.parse({ items, total: items.length });
  });
};
