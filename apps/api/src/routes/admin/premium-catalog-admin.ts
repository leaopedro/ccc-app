/**
 * premium-catalog-admin routes — WRITE side of the premium subscription
 * catalog. Mounted under the /admin prefix behind requireRole('organizer',
 * 'admin'), so paths here are relative (e.g. /premium/plans → /admin/premium/plans).
 *
 * This is the ADMIN surface: provider price ids (stripePriceId / rcProductId)
 * ARE accepted and returned here. The public read routes in premium-catalog.ts
 * stay untouched and never expose them.
 *
 * Deletes are SOFT (active=false): memberships resolve plans by tier and
 * PremiumMembershipAddon has an onDelete:Restrict FK to module.key, so history
 * must survive.
 */

import { prisma } from '@jdm/db';
import {
  adminPremiumAddonModuleCreateSchema,
  adminPremiumAddonModuleSchema,
  adminPremiumAddonModuleUpdateSchema,
  adminPremiumBenefitsReplaceResponseSchema,
  adminPremiumBenefitsReplaceSchema,
  adminPremiumCatalogResponseSchema,
  adminPremiumPlanCreateSchema,
  adminPremiumPlanSchema,
  adminPremiumPlanUpdateSchema,
  adminPremiumPlanPriceSchema,
  adminPremiumPriceUpsertSchema,
} from '@jdm/shared/admin';
import type {
  PremiumAddonModule as DbPremiumAddonModule,
  PremiumPlan as DbPremiumPlan,
  PremiumPlanBenefit as DbPremiumPlanBenefit,
  PremiumPlanPrice as DbPremiumPlanPrice,
  Prisma,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const cadenceSchema = z.enum(['monthly', 'annual']);

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: string }).code === 'P2002';

type PlanWithRelations = DbPremiumPlan & {
  prices: DbPremiumPlanPrice[];
  benefits: DbPremiumPlanBenefit[];
};

const PLAN_INCLUDE = {
  prices: { orderBy: { cadence: 'asc' } },
  benefits: { orderBy: { sortOrder: 'asc' } },
} as const;

const serializePrice = (p: DbPremiumPlanPrice) => ({
  cadence: p.cadence,
  baseAmountCents: p.baseAmountCents,
  currency: p.currency,
  stripePriceId: p.stripePriceId,
  rcProductId: p.rcProductId,
  active: p.active,
});

const serializeBenefit = (b: DbPremiumPlanBenefit) => ({
  id: b.id,
  label: b.label,
  sortOrder: b.sortOrder,
});

const serializePlan = (plan: PlanWithRelations) => ({
  id: plan.id,
  tier: plan.tier,
  slug: plan.slug,
  name: plan.name,
  description: plan.description,
  active: plan.active,
  sortOrder: plan.sortOrder,
  prices: plan.prices.map(serializePrice),
  benefits: plan.benefits.map(serializeBenefit),
  createdAt: plan.createdAt.toISOString(),
  updatedAt: plan.updatedAt.toISOString(),
});

const serializeModule = (m: DbPremiumAddonModule) => ({
  id: m.id,
  key: m.key,
  name: m.name,
  description: m.description,
  monthlyDeltaCents: m.monthlyDeltaCents,
  currency: m.currency,
  quotaPerCycle: m.quotaPerCycle,
  quotaUnit: m.quotaUnit,
  active: m.active,
  sortOrder: m.sortOrder,
  stripePriceId: m.stripePriceId,
  rcProductId: m.rcProductId,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const adminPremiumCatalogRoutes: FastifyPluginAsync = async (app) => {
  // Full editor payload: every plan (incl. inactive) with all prices +
  // benefits, plus every addon module (incl. inactive).
  app.get('/premium/catalog', async () => {
    const plans = await prisma.premiumPlan.findMany({
      orderBy: { sortOrder: 'asc' },
      include: PLAN_INCLUDE,
    });
    const modules = await prisma.premiumAddonModule.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return adminPremiumCatalogResponseSchema.parse({
      plans: plans.map(serializePlan),
      modules: modules.map(serializeModule),
    });
  });

  app.post('/premium/plans', async (request, reply) => {
    const parsed = adminPremiumPlanCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    try {
      const created = await prisma.premiumPlan.create({
        data: {
          tier: input.tier,
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          active: input.active,
          sortOrder: input.sortOrder ?? 0,
        },
        include: PLAN_INCLUDE,
      });
      return reply.status(201).send(adminPremiumPlanSchema.parse(serializePlan(created)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply
          .status(409)
          .send({ error: 'AlreadyExists', message: 'tier or slug already exists' });
      }
      throw err;
    }
  });

  app.patch('/premium/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPremiumPlanUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;

    const existing = await prisma.premiumPlan.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.PremiumPlanUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await prisma.premiumPlan.update({
      where: { id },
      data,
      include: PLAN_INCLUDE,
    });
    return reply.send(adminPremiumPlanSchema.parse(serializePlan(updated)));
  });

  // SOFT delete — set active=false. Never hard-delete.
  app.delete('/premium/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.premiumPlan.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const updated = await prisma.premiumPlan.update({
      where: { id },
      data: { active: false },
      include: PLAN_INCLUDE,
    });
    return reply.send(adminPremiumPlanSchema.parse(serializePlan(updated)));
  });

  // Upsert one price per (planId, cadence).
  app.put('/premium/plans/:id/prices/:cadence', async (request, reply) => {
    const { id, cadence } = request.params as { id: string; cadence: string };
    const cadenceParsed = cadenceSchema.safeParse(cadence);
    if (!cadenceParsed.success) {
      return reply
        .status(422)
        .send({ error: 'UnprocessableEntity', issues: cadenceParsed.error.issues });
    }
    const parsed = adminPremiumPriceUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;

    const plan = await prisma.premiumPlan.findUnique({ where: { id } });
    if (!plan) return reply.status(404).send({ error: 'NotFound' });

    const price = await prisma.premiumPlanPrice.upsert({
      where: { planId_cadence: { planId: id, cadence: cadenceParsed.data } },
      update: {
        baseAmountCents: input.baseAmountCents,
        currency: input.currency,
        stripePriceId: input.stripePriceId ?? null,
        rcProductId: input.rcProductId ?? null,
        active: input.active,
      },
      create: {
        planId: id,
        cadence: cadenceParsed.data,
        baseAmountCents: input.baseAmountCents,
        currency: input.currency,
        stripePriceId: input.stripePriceId ?? null,
        rcProductId: input.rcProductId ?? null,
        active: input.active,
      },
    });
    return reply.send(adminPremiumPlanPriceSchema.parse(serializePrice(price)));
  });

  // Replace the full benefit list in a single transaction (delete + recreate),
  // mirroring seedPremiumCatalog.
  app.put('/premium/plans/:id/benefits', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPremiumBenefitsReplaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }

    const plan = await prisma.premiumPlan.findUnique({ where: { id } });
    if (!plan) return reply.status(404).send({ error: 'NotFound' });

    await prisma.$transaction([
      prisma.premiumPlanBenefit.deleteMany({ where: { planId: id } }),
      prisma.premiumPlanBenefit.createMany({
        data: parsed.data.benefits.map((b) => ({
          planId: id,
          label: b.label,
          sortOrder: b.sortOrder,
        })),
      }),
    ]);

    const benefits = await prisma.premiumPlanBenefit.findMany({
      where: { planId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return reply.send(
      adminPremiumBenefitsReplaceResponseSchema.parse({ benefits: benefits.map(serializeBenefit) }),
    );
  });

  app.post('/premium/addon-modules', async (request, reply) => {
    const parsed = adminPremiumAddonModuleCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    try {
      const created = await prisma.premiumAddonModule.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description,
          monthlyDeltaCents: input.monthlyDeltaCents,
          quotaPerCycle: input.quotaPerCycle,
          quotaUnit: input.quotaUnit,
          currency: input.currency,
          active: input.active,
          sortOrder: input.sortOrder ?? 0,
          stripePriceId: input.stripePriceId ?? null,
          rcProductId: input.rcProductId ?? null,
        },
      });
      return reply.status(201).send(adminPremiumAddonModuleSchema.parse(serializeModule(created)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'AlreadyExists', message: 'key already exists' });
      }
      throw err;
    }
  });

  app.patch('/premium/addon-modules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPremiumAddonModuleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;

    const existing = await prisma.premiumAddonModule.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.PremiumAddonModuleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.monthlyDeltaCents !== undefined) data.monthlyDeltaCents = input.monthlyDeltaCents;
    if (input.quotaPerCycle !== undefined) data.quotaPerCycle = input.quotaPerCycle;
    if (input.quotaUnit !== undefined) data.quotaUnit = input.quotaUnit;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.stripePriceId !== undefined) data.stripePriceId = input.stripePriceId;
    if (input.rcProductId !== undefined) data.rcProductId = input.rcProductId;

    const updated = await prisma.premiumAddonModule.update({ where: { id }, data });
    return reply.send(adminPremiumAddonModuleSchema.parse(serializeModule(updated)));
  });

  // SOFT delete — set active=false. Hard delete is unsafe: PremiumMembershipAddon
  // has an onDelete:Restrict FK to module.key.
  app.delete('/premium/addon-modules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.premiumAddonModule.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const updated = await prisma.premiumAddonModule.update({
      where: { id },
      data: { active: false },
    });
    return reply.send(adminPremiumAddonModuleSchema.parse(serializeModule(updated)));
  });
};
