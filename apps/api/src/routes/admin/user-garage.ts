import { prisma } from '@ccc/db';
import {
  adminGaragePatchSchema,
  adminGaragePremiumSchema,
  adminGarageReadSchema,
  adminGarageSpotRevokeBodySchema,
  adminGarageSummarySchema,
} from '@ccc/shared/admin-garage';
import { badgeCodeSchema } from '@ccc/shared/badges';
import { GARAGE_RESERVED_SLUGS } from '@ccc/shared/garage';
import type { Garage, GarageSpot } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';
import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { awardBadge } from '../../services/garage/awarder.js';
import { ensureGarageForUserId } from '../../services/garage/ensure.js';
import { computeIsPremiumActive, reconcileGarageSpots } from '../../services/garage/index.js';
import rateLimit from '@fastify/rate-limit';
import { awardXp } from '../../services/garage/xp-awarder.js';

const serializeGarageSummary = (g: Garage) => ({
  id: g.id,
  userId: g.userId,
  name: g.name,
  slug: g.slug,
  description: g.description,
  isPublic: g.isPublic,
  premiumTier: g.premiumTier,
  premiumUntil: g.premiumUntil ? g.premiumUntil.toISOString() : null,
  isPremiumActive: computeIsPremiumActive(g.premiumTier, g.premiumUntil),
  createdAt: g.createdAt.toISOString(),
  updatedAt: g.updatedAt.toISOString(),
});

const serializeGarageSpot = (s: GarageSpot) => ({
  id: s.id,
  source: s.source,
  carId: s.carId,
  sourceOrderItemId: s.sourceOrderItemId,
  createdAt: s.createdAt.toISOString(),
});

export const adminUserGarageRoutes: FastifyPluginAsync = async (app) => {
  // GET /admin/users/:id/garage — read garage profile + spots.
  app.get('/users/:id/garage', async (request, reply) => {
    requireUser(request);
    const { id } = request.params as { id: string };

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    const garage = await ensureGarageForUserId(id);
    // Materialize default_free spots against the current cap before reading
    // so the panel reflects the user's true entitlement on bounded caps
    // (same pattern as /me/garage). No-op on unlimited caps.
    await reconcileGarageSpots(id);
    const spots = await prisma.garageSpot.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'asc' },
    });

    return adminGarageReadSchema.parse({
      user: target,
      garage: serializeGarageSummary(garage),
      spots: spots.map(serializeGarageSpot),
    });
  });

  // POST /admin/users/:id/garage/premium — grant or revoke premium.
  app.post('/users/:id/garage/premium', async (request, reply) => {
    const actor = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminGaragePremiumSchema.parse(request.body);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    const garage = await ensureGarageForUserId(id);

    const isRevoke = input.tier === null;
    const action = isRevoke ? 'garage.premium_revoke' : 'garage.premium_grant';
    const nextPremiumUntil = isRevoke ? null : (input.premiumUntil ?? null);

    const updated = await prisma.$transaction(async (tx) => {
      // Pre-update snapshot — needed for the wasActive transition check.
      // Read inside the tx so we serialize against any concurrent grant on
      // the same garage row (otherwise two simultaneous inactive→active
      // updates could both observe wasActive=false and both try to award).
      const before = await tx.garage.findUniqueOrThrow({
        where: { id: garage.id },
        select: { premiumTier: true, premiumUntil: true },
      });
      const wasActive = computeIsPremiumActive(before.premiumTier, before.premiumUntil);

      const u = await tx.garage.update({
        where: { id: garage.id },
        data: {
          premiumTier: input.tier,
          premiumUntil: nextPremiumUntil ? new Date(nextPremiumUntil) : null,
        },
      });
      await recordAudit(
        {
          actorId: actor.sub,
          action,
          entityType: 'garage',
          entityId: garage.id,
          metadata: {
            userId: id,
            previousTier: garage.premiumTier,
            previousPremiumUntil: garage.premiumUntil ? garage.premiumUntil.toISOString() : null,
            newTier: input.tier,
            newPremiumUntil: nextPremiumUntil,
          },
        },
        tx,
      );

      // §"Locked invariants" #3 + §"Decisions locked at kickoff" #1:
      // premium_activation is +200 XP, one-shot ever per garage. Fixed
      // sourceRef `garage:<garageId>` + the XpEvent unique (§C1) make P2002
      // the one-shot enforcer at the DB layer — awarder catches it and
      // returns awarded:false silently on re-activation. Only fires on
      // grant; revoke leaves historical XP intact (XP cannot decrease
      // except via like-revert or admin_adjustment).
      //
      // Gate on the INACTIVE → ACTIVE transition, not just on "active now":
      // an admin updating tier bronze→gold while still active leaves the
      // post-update row active too, but it is NOT an activation event. If
      // no prior XpEvent exists (killswitch was off at first grant,
      // pre-Phase-2 grant, manual SQL import), the post-update-only gate
      // would create a second XpEvent and award +200 again, violating
      // locked invariant #3 (one-shot ever per garage). The app-level
      // wasActive gate is the PRIMARY defense; the DB unique + awarder
      // SAVEPOINT remain as belt-and-suspenders for the genuine race
      // (two concurrent inactive→active grants both see wasActive=false).
      const isActive = computeIsPremiumActive(u.premiumTier, u.premiumUntil);
      if (!isRevoke && !wasActive && isActive) {
        await awardXp(tx, garage.id, 'premium_activation', {
          sourceRef: `garage:${garage.id}`,
        });
      }

      return u;
    });

    return adminGarageSummarySchema.parse(serializeGarageSummary(updated));
  });

  // PATCH /admin/users/:id/garage — admin override of Garage profile fields.
  app.patch('/users/:id/garage', async (request, reply) => {
    const actor = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminGaragePatchSchema.parse(request.body);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    const garage = await ensureGarageForUserId(id);

    // Reserved-slug list still applies to admin overrides — slugs that
    // collide with top-level routes break the public surface regardless of
    // who set them.
    if (input.slug !== undefined && GARAGE_RESERVED_SLUGS.has(input.slug)) {
      return reply.status(400).send({ error: 'reserved_slug' });
    }

    const slugChanged = input.slug !== undefined && input.slug !== garage.slug;
    const action = slugChanged ? 'garage.slug_override' : 'garage.update';

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.garage.update({
          where: { id: garage.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
          },
        });
        await recordAudit(
          {
            actorId: actor.sub,
            action,
            entityType: 'garage',
            entityId: garage.id,
            metadata: {
              userId: id,
              fields: Object.keys(input),
              before: {
                ...(input.name !== undefined ? { name: garage.name } : {}),
                ...(input.slug !== undefined ? { slug: garage.slug } : {}),
                ...(input.description !== undefined ? { description: garage.description } : {}),
                ...(input.isPublic !== undefined ? { isPublic: garage.isPublic } : {}),
              },
              after: {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.slug !== undefined ? { slug: input.slug } : {}),
                ...(input.description !== undefined ? { description: input.description } : {}),
                ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
              },
            },
          },
          tx,
        );
        return u;
      });
      return adminGarageSummarySchema.parse(serializeGarageSummary(updated));
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        return reply.status(409).send({ error: 'slug_taken' });
      }
      throw e;
    }
  });

  // POST /admin/users/:id/garage/spots — grant an extra spot.
  app.post('/users/:id/garage/spots', async (request, reply) => {
    const actor = requireUser(request);
    const { id } = request.params as { id: string };

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    // Ensure the garage row exists so the spot panel always has a parent.
    await ensureGarageForUserId(id);

    const created = await prisma.$transaction(async (tx) => {
      const spot = await tx.garageSpot.create({
        data: {
          userId: id,
          source: 'admin_grant',
          carId: null,
        },
      });
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'garage.spot_grant',
          entityType: 'garage_spot',
          entityId: spot.id,
          metadata: { userId: id, source: 'admin_grant' },
        },
        tx,
      );
      return spot;
    });

    return reply.status(201).send(serializeGarageSpot(created));
  });

  // DELETE /admin/users/:id/garage/spots/:spotId — revoke an extra spot.
  // Refuses default_free spots. Refuses filled spots (clear the car first).
  app.delete('/users/:id/garage/spots/:spotId', async (request, reply) => {
    const actor = requireUser(request);
    const { id, spotId } = request.params as { id: string; spotId: string };
    const body = adminGarageSpotRevokeBodySchema.parse(request.body ?? {});
    const reason = body.reason ?? 'manual_cleanup';

    // Cheap pre-tx ownership + source checks for 404 / 400. The 409
    // filled-spot guard MUST live inside the same tx as the delete so a
    // concurrent allocation can't slip a carId in between check and delete.
    const preview = await prisma.garageSpot.findUnique({ where: { id: spotId } });
    if (!preview || preview.userId !== id) {
      return reply.status(404).send({ error: 'NotFound' });
    }
    if (preview.source === 'default_free') {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'default_free spots cannot be revoked manually',
      });
    }

    type TxResult =
      | { ok: true; source: string; sourceOrderItemId: string | null }
      | { ok: false; reason: 'notfound' | 'conflict' };

    const result = await prisma.$transaction<TxResult>(async (tx) => {
      // Re-read inside the tx so we have current source/sourceOrderItemId
      // for the audit and to re-validate ownership + source under tx.
      const current = await tx.garageSpot.findUnique({ where: { id: spotId } });
      if (!current || current.userId !== id) {
        return { ok: false, reason: 'notfound' };
      }
      if (current.source === 'default_free') {
        // Race: spot mutated into default_free between pre-check and tx.
        // Treat as conflict — never reachable in current data flow but
        // defensive against future changes.
        return { ok: false, reason: 'conflict' };
      }
      // Conditional delete: only succeeds if the spot is still empty.
      // Concurrent car allocation that sets carId will leave count === 0
      // and we report 409.
      const del = await tx.garageSpot.deleteMany({
        where: { id: spotId, userId: id, carId: null },
      });
      if (del.count !== 1) {
        return { ok: false, reason: 'conflict' };
      }
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'garage.spot_revoke',
          entityType: 'garage_spot',
          entityId: spotId,
          metadata: {
            userId: id,
            source: current.source,
            sourceOrderItemId: current.sourceOrderItemId,
            reason,
          },
        },
        tx,
      );
      return {
        ok: true,
        source: current.source,
        sourceOrderItemId: current.sourceOrderItemId,
      };
    });

    if (!result.ok) {
      if (result.reason === 'notfound') {
        return reply.status(404).send({ error: 'NotFound' });
      }
      return reply.status(409).send({
        error: 'Conflict',
        message: 'spot has a car; remove the car first',
      });
    }

    return reply.status(204).send();
  });

  // POST /admin/users/:id/garage/badges/:code/grant — admin manual badge
  // grant. The premium-exclusive gate is bypassable via
  // `awardBadge(..., { allowAdminOverride: true })`: kickoff decision lets
  // an admin grant premium-exclusive specs (CAR-003, CCC-003, etc.) to
  // non-premium users for support cases. This intentionally deviates from
  // the reviewer's recommendation — documented in the chunk-18 PR §Deviations.
  //
  // Body is empty. Rate-limit 30/min/admin scoped to this endpoint via a
  // dedicated register block. The killswitch still applies (admin manual
  // grant is no-op when Conquistas are globally disabled — there's no
  // reason to land a row that the read paths will hide).
  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-badge-grant:${auth.sub}` : `admin-badge-grant-ip:${req.ip}`;
      },
    });

    scope.post('/users/:id/garage/badges/:code/grant', async (request, reply) => {
      const actor = requireUser(request);
      const { id, code } = request.params as { id: string; code: string };

      const parsedCode = badgeCodeSchema.safeParse(code);
      if (!parsedCode.success) {
        return reply.status(400).send({ error: 'invalid_code' });
      }

      const target = await prisma.user.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!target) return reply.status(404).send({ error: 'NotFound' });

      const garage = await ensureGarageForUserId(id);

      const outcome = await prisma.$transaction((tx) =>
        awardBadge(tx, garage.id, parsedCode.data, `admin:${actor.sub}`, {
          actorId: actor.sub,
          allowAdminOverride: true,
          // Chunk 22: admin manual grants surface as in-app notifications
          // on the next mobile garage load. Auto-award write-path hooks
          // (cars/feed/check-in/signup) intentionally omit this flag so
          // they stay silent.
          notifyOnGrant: true,
        }),
      );

      if (outcome.awarded) {
        return reply.status(201).send({ awarded: true, code: parsedCode.data });
      }

      switch (outcome.reason) {
        case 'gamification_disabled':
          return reply.status(409).send({ error: 'gamification_disabled' });
        case 'already_earned':
          return reply.status(409).send({ error: 'already_earned' });
        case 'premium_required':
          // Should not happen here because allowAdminOverride is on, but
          // keep the explicit branch so a future flag flip doesn't drop a
          // silent 200. Reachable only if the awarder gains a new gate.
          return reply.status(409).send({ error: 'premium_required' });
        default:
          return reply.status(500).send({ error: 'InternalServerError' });
      }
    });
  });
};
