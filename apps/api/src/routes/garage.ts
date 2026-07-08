import rateLimit from '@fastify/rate-limit';
import { prisma } from '@ccc/db';
import { badgeCodeSchema } from '@ccc/shared/badges';
import {
  GARAGE_RESERVED_SLUGS,
  garageCoverPatchSchema,
  garagePatchSchema,
  garageReadSchema,
} from '@ccc/shared/garage';
import { GARAGE_COVER_PRESETS } from '@ccc/shared/garage-covers';
import { garagePublicResponseSchema } from '@ccc/shared/garage-public';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@ccc/shared/uploads';
import type { Garage } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { requireUser } from '../plugins/auth.js';
import { recordAudit } from '../services/admin-audit.js';
import { readOwnerBadgesState, readPublicBadges } from '../services/garage/badges-read.js';
import { validateCoverPatch, type CoverPatch } from '../services/garage/cover.js';
import {
  computeIsPremiumActive,
  defaultGarageSlugForUserId,
  findFreeGarageSlug,
  reconcileGarageSpots,
  serializeGarageOwner,
  serializeGaragePublic,
} from '../services/garage/index.js';
import { readGamificationEnabled } from '../services/garage/killswitch.js';
import { getGarageProgress } from '../services/garage/progress.js';
import { getGarageStats } from '../services/garage/stats.js';
import type { Uploads } from '../services/uploads/index.js';

import { serializeCar } from './cars-serializer.js';

// Body schema for POST /me/garage/cover/upload. No `kind` field — the
// route injects `kind: 'garage_cover'` server-side so the client can never
// repoint the presign at another upload category.
const coverUploadBodySchema = z
  .object({
    contentType: z.enum(ALLOWED_IMAGE_TYPES),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .strict();

const serializeSpot = (s: {
  id: string;
  source: 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
  carId: string | null;
  createdAt: Date;
}) => ({
  id: s.id,
  source: s.source,
  carId: s.carId,
  createdAt: s.createdAt.toISOString(),
});

// Lazy-create a garage row for users that pre-date the signup hook + backfill.
// Defensive only — production data flows through the signup tx + migration
// backfill. Tests that create users via prisma.user.create() directly also
// land here, but the test helpers create the Garage eagerly to avoid drift.
const ensureGarageForUser = async (userId: string): Promise<Garage> => {
  const existing = await prisma.garage.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      const already = await tx.garage.findUnique({ where: { userId } });
      if (already) return already;
      const slug = await findFreeGarageSlug(tx, defaultGarageSlugForUserId(userId));
      return tx.garage.create({
        data: {
          userId,
          name: 'Garagem',
          slug,
          isPublic: false,
        },
      });
    });
  } catch (e) {
    // Concurrent ensureGarageForUser racing on the same userId: both miss the
    // pre-tx read, both enter the tx, second create hits @unique. Return the
    // winner's row instead of bubbling P2002.
    if (isUniqueConstraintError(e)) {
      const winner = await prisma.garage.findUnique({ where: { userId } });
      if (winner) return winner;
    }
    throw e;
  }
};

const loadOwnerView = async (userId: string, uploads: Uploads) => {
  const garage = await ensureGarageForUser(userId);
  const reconciled = await reconcileGarageSpots(userId);
  // §C5: synchronous per-request killswitch read, no TTL cache.
  const gamificationEnabled = await readGamificationEnabled();

  const [cars, spots, badgesState, progress, stats] = await Promise.all([
    prisma.car.findMany({
      where: { userId },
      include: {
        photos: true,
        user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.garageSpot.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, source: true, carId: true, createdAt: true },
    }),
    gamificationEnabled ? readOwnerBadgesState(garage) : Promise.resolve(null),
    // Canon §3: service called as (prisma, garageId) — prisma FIRST.
    // Owner ALWAYS renders both blocks when killswitch is on (no hide-on-
    // empty for /me/garage per "Locked invariants" #2).
    gamificationEnabled ? getGarageProgress(prisma, garage.id) : Promise.resolve(null),
    gamificationEnabled ? getGarageStats(prisma, garage.id) : Promise.resolve(null),
  ]);

  const availableSlots = spots.filter((s) => s.carId === null).length;
  const ownerBadges = badgesState?.badges ?? [];

  return garageReadSchema.parse({
    garage: serializeGarageOwner(garage, uploads, {
      gamificationEnabled,
      badges: ownerBadges,
    }),
    cars: cars.map((c) => serializeCar(c, uploads)),
    spots: spots.map(serializeSpot),
    availableSlots,
    freeLimit: reconciled.freeLimit,
    isUnlimited: reconciled.isUnlimited,
    // Canon §1: top-level capability flag — always present, never nested.
    gamification: { enabled: gamificationEnabled },
    // §C10: optional schemas. Spread to omit (not null) when killswitch off.
    ...(progress ? { progress } : {}),
    ...(stats ? { stats } : {}),
  });
};

export const garageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/garage', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    return loadOwnerView(sub, app.uploads);
  });

  // PATCH /me/garage — rate-limited to 10/min/user. Slug edits are the
  // most-likely abuse vector (enumerate vanity slugs), hence the cap.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const user = request.user as { sub: string } | undefined;
        return `garage-patch:${user?.sub ?? request.ip}`;
      },
    });

    scoped.patch('/me/garage', async (request, reply) => {
      const { sub } = requireUser(request);
      let patch: ReturnType<typeof garagePatchSchema.parse>;
      try {
        patch = garagePatchSchema.parse(request.body);
      } catch (e) {
        // §C7: the slug field's `.superRefine` emits a `'invalid_slug'`
        // ZodIssue on regex violation. Distinguish that from the other
        // shape errors so the client can show the right copy ("URL pode
        // usar apenas letras minúsculas, números e hífens.") instead of
        // the generic save-failed toast.
        if (e instanceof z.ZodError) {
          const hasInvalidSlug = e.issues.some((iss) => iss.message === 'invalid_slug');
          if (hasInvalidSlug) {
            return reply.status(400).send({ error: 'invalid_slug' });
          }
        }
        throw e;
      }

      if (patch.slug !== undefined && GARAGE_RESERVED_SLUGS.has(patch.slug)) {
        return reply.status(400).send({ error: 'reserved_slug' });
      }

      // Ensure the garage exists so PATCH works on accounts that pre-date
      // the signup hook (production backfill covers this, but test helpers
      // can create users directly).
      await ensureGarageForUser(sub);

      try {
        const updated = await prisma.garage.update({
          where: { userId: sub },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
          },
        });
        const gamificationEnabled = await readGamificationEnabled();
        const badgesState = gamificationEnabled ? await readOwnerBadgesState(updated) : null;
        return {
          garage: serializeGarageOwner(updated, app.uploads, {
            gamificationEnabled,
            badges: badgesState?.badges ?? [],
          }),
        };
      } catch (e) {
        if (isUniqueConstraintError(e)) {
          return reply.status(409).send({ error: 'slug_taken' });
        }
        throw e;
      }
    });
  });

  // GET /me/garage/cover/presets — authenticated catalog read. Rate-limited
  // to 60/min/ip because every preset thumbnail is publicly bundled in R2;
  // the cap is throttle-only, not abuse-control.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 60,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => `garage-cover-presets:${request.ip}`,
    });

    // eslint-disable-next-line @typescript-eslint/require-await
    scoped.get('/me/garage/cover/presets', async () => {
      const presets = GARAGE_COVER_PRESETS.map((p) => ({
        slug: p.slug,
        label: p.label,
        premium: p.premium,
        imageUrl: app.uploads.buildPublicUrl(`garage-cover-presets/${p.slug}@2x.jpg`),
      }));
      return { presets };
    });
  });

  // POST /me/garage/cover/upload — thin wrapper around the existing
  // presign service. Premium-gated (free users get 400 BEFORE any presign
  // side effect) and rate-limited to 5/min/user. The wrapper exists so the
  // limiter sits here, not on /uploads/presign (per §C6).
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const user = request.user as { sub: string } | undefined;
        return `garage-cover-upload:${user?.sub ?? request.ip}`;
      },
    });

    scoped.post('/me/garage/cover/upload', async (request, reply) => {
      const { sub } = requireUser(request);
      const { contentType, size } = coverUploadBodySchema.parse(request.body);

      const garage = await ensureGarageForUser(sub);
      if (!computeIsPremiumActive(garage.premiumTier, garage.premiumUntil)) {
        return reply.status(400).send({ error: 'premium_required' });
      }

      const result = await app.uploads.presignPut({
        kind: 'garage_cover',
        userId: sub,
        contentType,
        size,
      });
      return {
        uploadUrl: result.uploadUrl,
        objectKey: result.objectKey,
        publicUrl: result.publicUrl,
        expiresAt: result.expiresAt.toISOString(),
        headers: result.headers,
      };
    });
  });

  // PATCH /me/garage/cover — sets either coverPreset OR coverImageObjectKey
  // (mutually exclusive at write). 5/min/user. Emits a single audit row per
  // accepted patch (cover_set when the new value is non-null, cover_reset
  // when null).
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const user = request.user as { sub: string } | undefined;
        return `garage-cover-patch:${user?.sub ?? request.ip}`;
      },
    });

    scoped.patch('/me/garage/cover', async (request, reply) => {
      const { sub } = requireUser(request);
      const patch = garageCoverPatchSchema.parse(request.body) as CoverPatch;

      const garage = await ensureGarageForUser(sub);
      const validation = validateCoverPatch(garage, patch);
      if (!validation.ok) {
        return reply.status(400).send({ error: validation.error });
      }

      const data: { coverPreset?: string | null; coverImageObjectKey?: string | null } = {};
      let prev: string | null;
      let next: string | null;

      if ('coverPreset' in validation.patch) {
        prev = garage.coverPreset;
        next = validation.patch.coverPreset;
        data.coverPreset = next;
        // Mutual exclusion: setting a preset clears any custom upload.
        if (next !== null) data.coverImageObjectKey = null;
      } else {
        prev = garage.coverImageObjectKey;
        next = validation.patch.coverImageObjectKey;
        data.coverImageObjectKey = next;
        // Mutual exclusion: setting a custom upload clears any preset.
        if (next !== null) data.coverPreset = null;
      }

      const updated = await prisma.garage.update({
        where: { userId: sub },
        data,
      });

      await recordAudit({
        actorId: sub,
        action: next === null ? 'garage.cover_reset' : 'garage.cover_set',
        entityType: 'garage',
        entityId: updated.id,
        metadata: { from: prev, to: next },
      });

      const gamificationEnabled = await readGamificationEnabled();
      const badgesState = gamificationEnabled ? await readOwnerBadgesState(updated) : null;
      return {
        garage: serializeGarageOwner(updated, app.uploads, {
          gamificationEnabled,
          badges: badgesState?.badges ?? [],
        }),
      };
    });
  });

  // GET /me/garage/badges — owner-state classification (earned + locked +
  // locked_premium). 60/min/user (read-only, throttle-only). Killswitch-aware:
  // returns `enabled: false` + empty arrays when gamification is disabled.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 60,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const user = request.user as { sub: string } | undefined;
        return `me-garage-badges:${user?.sub ?? request.ip}`;
      },
    });

    scoped.get('/me/garage/badges', async (request) => {
      const { sub } = requireUser(request);
      const enabled = await readGamificationEnabled();
      if (!enabled) return { enabled: false, catalog: [], badges: [] };

      const garage = await ensureGarageForUser(sub);
      const { catalog, badges } = await readOwnerBadgesState(garage);
      return { enabled: true, catalog, badges };
    });
  });

  // PATCH /me/garage/badges/:code/pin — toggle pinned state. 20/min/user.
  // 3-pin cap enforced BEFORE the update, only when transitioning unpinned →
  // pinned (re-pinning an already-pinned badge is a no-op for the cap). Audit
  // row written via the existing recordAudit helper; action discriminates
  // pin vs unpin, metadata.badgeCode carries the spec id.
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 20,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => {
        const user = request.user as { sub: string } | undefined;
        return `badge-pin:${user?.sub ?? request.ip}`;
      },
    });

    scoped.patch<{ Params: { code: string }; Body: { pinned: boolean } }>(
      '/me/garage/badges/:code/pin',
      async (request, reply) => {
        const { sub } = requireUser(request);

        const enabled = await readGamificationEnabled();
        if (!enabled) return reply.status(409).send({ error: 'gamification_disabled' });

        // Param validation matches the wire-format regex
        // (3 uppercase letters + dash + 3 digits). Unknown codes fall through
        // to the `not_found` branch below via the FK lookup miss.
        const codeParse = badgeCodeSchema.safeParse(request.params.code);
        if (!codeParse.success) return reply.status(404).send({ error: 'not_found' });
        const code = codeParse.data;

        const bodyParse = z.object({ pinned: z.boolean() }).strict().safeParse(request.body);
        if (!bodyParse.success) return reply.status(400).send({ error: 'invalid_body' });
        const { pinned } = bodyParse.data;

        const garage = await ensureGarageForUser(sub);

        // Serializable tx: the 3-pin cap check is a predicate-read (count)
        // followed by an update. Two concurrent PATCHes (different badges,
        // same garage) without isolation can both see currentPins < 3 and
        // both transition to pinned, ending at 4 pinned rows. Serializable
        // catches the predicate-read conflict on commit and aborts one tx
        // with P2034; we retry up to 3 times.
        let result:
          | {
              kind: 'ok';
              updated: {
                badgeCode: string;
                earnedAt: Date;
                pinned: boolean;
                pinnedAt: Date | null;
              };
            }
          | { kind: 'not_found' }
          | { kind: 'pin_limit' }
          | null = null;
        for (let attempt = 0; ; attempt++) {
          try {
            result = await prisma.$transaction(
              async (tx) => {
                const existing = await tx.garageBadge.findUnique({
                  where: { garageId_badgeCode: { garageId: garage.id, badgeCode: code } },
                });
                if (!existing) return { kind: 'not_found' as const };
                if (pinned && !existing.pinned) {
                  const currentPins = await tx.garageBadge.count({
                    where: { garageId: garage.id, pinned: true },
                  });
                  if (currentPins >= 3) return { kind: 'pin_limit' as const };
                }
                const updated = await tx.garageBadge.update({
                  where: { garageId_badgeCode: { garageId: garage.id, badgeCode: code } },
                  data: { pinned, pinnedAt: pinned ? new Date() : null },
                });
                return { kind: 'ok' as const, updated };
              },
              { isolationLevel: 'Serializable' },
            );
            break;
          } catch (err) {
            const isConflict =
              typeof err === 'object' &&
              err !== null &&
              ((err as { code?: unknown }).code === 'P2034' ||
                (typeof (err as { message?: unknown }).message === 'string' &&
                  (err as { message: string }).message.toLowerCase().includes('serializ')));
            if (attempt >= 3 || !isConflict) throw err;
          }
        }
        if (result.kind === 'not_found') return reply.status(404).send({ error: 'not_found' });
        if (result.kind === 'pin_limit') return reply.status(409).send({ error: 'pin_limit' });
        const updated = result.updated;

        await recordAudit({
          actorId: sub,
          action: pinned ? 'badge.pin' : 'badge.unpin',
          entityType: 'garage',
          entityId: garage.id,
          metadata: { badgeCode: code },
        });

        return {
          badge: {
            code: updated.badgeCode,
            earnedAt: updated.earnedAt.toISOString(),
            pinned: updated.pinned,
            pinnedAt: updated.pinnedAt ? updated.pinnedAt.toISOString() : null,
          },
        };
      },
    );
  });

  // GET /g/:slug — public, anti-enumeration. 404 for unknown slug OR private
  // garage. Indistinguishable by design.
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 60,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (request) => `garage-public:${request.ip}`,
    });

    scoped.get<{ Params: { slug: string } }>('/g/:slug', async (request, reply) => {
      const { slug } = request.params;
      const garage = await prisma.garage.findUnique({ where: { slug } });
      if (!garage || !garage.isPublic) {
        // §C9: byte-identical 404 between unknown-slug and private-garage paths.
        // Do NOT mutate this branch — regression test asserts byte parity.
        return reply.status(404).send({ error: 'NotFound' });
      }

      // §C5: synchronous per-request killswitch read, no TTL cache.
      const gamificationEnabled = await readGamificationEnabled();

      // Exclude any premium "extra-only" car semantics if/when they exist —
      // currently every car is publishable. Photos use existing public URLs.
      const [cars, publicBadges, progress, stats] = await Promise.all([
        prisma.car.findMany({
          where: { userId: garage.userId },
          include: { photos: true },
          orderBy: { createdAt: 'desc' },
        }),
        gamificationEnabled ? readPublicBadges(garage) : Promise.resolve([]),
        // Canon §3: service called as (prisma, garageId) — prisma FIRST.
        gamificationEnabled ? getGarageProgress(prisma, garage.id) : Promise.resolve(null),
        gamificationEnabled ? getGarageStats(prisma, garage.id) : Promise.resolve(null),
      ]);

      // Locked invariants #2: public hides BOTH blocks only when ALL FOUR
      // metrics are zero (xp + events + posts + likesReceived). Owner path
      // (handled in loadOwnerView) always renders when killswitch is on.
      const allZero =
        !!progress &&
        !!stats &&
        progress.xp === 0 &&
        stats.events === 0 &&
        stats.posts === 0 &&
        stats.likesReceived === 0;
      const includeProgressStats = gamificationEnabled && !allZero;

      const payload = garagePublicResponseSchema.parse({
        garage: serializeGaragePublic(garage, app.uploads, {
          gamificationEnabled,
          badges: publicBadges,
        }),
        cars: cars.map((c) => {
          const photos = c.photos
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => ({
              id: p.id,
              url: app.uploads.buildPublicUrl(p.objectKey),
              width: p.width,
              height: p.height,
            }));
          return {
            id: c.id,
            make: c.make,
            model: c.model,
            year: c.year,
            nickname: c.nickname,
            modifications: c.modifications,
            photos,
          };
        }),
        // Canon §1: top-level capability flag — always present, never nested.
        gamification: { enabled: gamificationEnabled },
        ...(includeProgressStats && progress ? { progress } : {}),
        ...(includeProgressStats && stats ? { stats } : {}),
      });
      return payload;
    });
  });

  // Expose the premium-active helper on the app for cross-route use.
  void computeIsPremiumActive;
};
