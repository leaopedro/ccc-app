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
 * is informational. That flag gates checkout/attach in a later phase.
 *
 * Provider price ids (stripePriceId/rcProductId) live on the DB rows but are
 * never serialized here; the response schemas do not carry them.
 */

import { prisma } from '@ccc/db';
import {
  premiumAddonModuleListResponseSchema,
  premiumPlanListResponseSchema,
  premiumPlanSchema,
} from '@ccc/shared/premium-catalog';
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

// eslint-disable-next-line @typescript-eslint/require-await
export const premiumCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/plans', async () => {
    const plans = await prisma.premiumPlan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: PLAN_INCLUDE,
    });
    return premiumPlanListResponseSchema.parse({
      plans: plans.map(serializePlan),
    });
  });

  app.get('/api/plans/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const plan = await prisma.premiumPlan.findFirst({
      where: { slug, active: true },
      include: PLAN_INCLUDE,
    });
    if (!plan) return reply.status(404).send({ error: 'NotFound' });
    return serializePlan(plan);
  });

  app.get('/api/addon-modules', async () => {
    const modules = await prisma.premiumAddonModule.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    return premiumAddonModuleListResponseSchema.parse({
      modules: modules.map(serializeAddonModule),
    });
  });
};
