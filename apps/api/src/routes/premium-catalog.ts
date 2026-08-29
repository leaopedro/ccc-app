/**
 * premium-catalog routes — READ side of the premium subscription catalog.
 *
 *   GET /api/plans             — active plans (ordered) with prices + benefits
 *   GET /api/plans/:slug       — single active plan by slug
 *   GET /api/addon-modules     — active add-on modules (ordered)
 *
 * UNAUTHED, like the other catalog reads (store.ts, badges-catalog.ts,
 * premium-pricing.ts). Both admin + mobile render the catalog before sign-in.
 *
 * These endpoints are NOT gated on GROWTH_PREMIUM_BILLING_ENABLED — the catalog
 * is informational. That flag gates checkout/attach in a later phase. They DO
 * carry the per-platform subscriptions gate (`request.subscriptionsEnabled`,
 * set by the platform-gate plugin): every response reports whether the caller's
 * platform can subscribe, alongside `Vary: x-ccc-platform` so a shared cache
 * never hands an iOS client the web answer.
 *
 * Provider price ids (stripePriceId/rcProductId) live on the DB rows but are
 * never serialized here; the response schemas do not carry them.
 */

import { prisma } from '@ccc/db';
import {
  premiumAddonModuleListResponseSchema,
  premiumPlanDetailResponseSchema,
  premiumPlanListResponseSchema,
  premiumPlanSchema,
} from '@ccc/shared/premium-catalog';
import rateLimit from '@fastify/rate-limit';
import type {
  PremiumAddonModule as DbPremiumAddonModule,
  PremiumPlan as DbPremiumPlan,
  PremiumPlanBenefit as DbPremiumPlanBenefit,
  PremiumPlanPrice as DbPremiumPlanPrice,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

type PlanWithRelations = DbPremiumPlan & {
  prices: DbPremiumPlanPrice[];
  benefits: DbPremiumPlanBenefit[];
};

const PLAN_INCLUDE = {
  prices: { where: { active: true }, orderBy: { cadence: 'asc' } },
  benefits: { orderBy: { sortOrder: 'asc' } },
} as const;

const serializePlan = (plan: PlanWithRelations) =>
  premiumPlanSchema.parse({
    tier: plan.tier,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    sortOrder: plan.sortOrder,
    prices: plan.prices.map((p) => ({
      cadence: p.cadence,
      baseAmountCents: p.baseAmountCents,
      currency: p.currency,
    })),
    benefits: plan.benefits.map((b) => ({
      label: b.label,
      sortOrder: b.sortOrder,
    })),
  });

const serializeAddonModule = (module: DbPremiumAddonModule) => ({
  key: module.key,
  name: module.name,
  description: module.description,
  monthlyDeltaCents: module.monthlyDeltaCents,
  currency: module.currency,
  quotaPerCycle: module.quotaPerCycle,
  quotaUnit: module.quotaUnit,
  sortOrder: module.sortOrder,
});

export const premiumCatalogRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `premium-catalog:${req.ip}`,
  });

  // The body varies on x-ccc-platform. Without both headers, any shared cache
  // may hand an iOS client the web answer.
  //
  // `reply.header('Vary', ...)` REPLACES rather than appends. @fastify/cors is
  // registered globally ahead of this plugin and may already have set
  // `Vary: Origin` on the same response; overwriting it here would silently
  // drop that entry. Append instead: read whatever Vary is already present
  // (string, string[], or unset — `getHeader` can return any of those) and
  // add x-ccc-platform only if it is not already listed.
  app.addHook('onSend', async (_request, reply) => {
    const existing = reply.getHeader('Vary');
    const existingValues = Array.isArray(existing)
      ? existing
      : existing === undefined
        ? []
        : [String(existing)];
    const parts = existingValues
      .flatMap((value) => value.split(','))
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.some((part) => part.toLowerCase() === 'x-ccc-platform')) {
      parts.push('x-ccc-platform');
    }
    void reply.header('Vary', parts.join(', '));
    void reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/plans', async (request) => {
    const plans = await prisma.premiumPlan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: PLAN_INCLUDE,
    });
    return premiumPlanListResponseSchema.parse({
      plans: plans.map(serializePlan),
      subscriptionsEnabled: request.subscriptionsEnabled,
    });
  });

  app.get('/api/plans/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const plan = await prisma.premiumPlan.findFirst({
      where: { slug, active: true },
      include: PLAN_INCLUDE,
    });
    if (!plan) return reply.status(404).send({ error: 'NotFound' });
    return premiumPlanDetailResponseSchema.parse({
      plan: serializePlan(plan),
      subscriptionsEnabled: request.subscriptionsEnabled,
    });
  });

  app.get('/api/addon-modules', async (request) => {
    const modules = await prisma.premiumAddonModule.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    return premiumAddonModuleListResponseSchema.parse({
      modules: modules.map(serializeAddonModule),
      subscriptionsEnabled: request.subscriptionsEnabled,
    });
  });
};
