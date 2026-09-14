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

import { prisma } from '@ccc/db';
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
} from '@ccc/shared/admin';
import type {
  PremiumAddonModule as DbPremiumAddonModule,
  PremiumPlan as DbPremiumPlan,
  PremiumPlanBenefit as DbPremiumPlanBenefit,
  PremiumPlanPrice as DbPremiumPlanPrice,
  Prisma,
} from '@prisma/client';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { StripeClient } from '../../services/stripe/index.js';

const cadenceSchema = z.enum(['monthly', 'annual']);

/**
 * Stripe Prices are immutable, so "changing a price" is always minting a new
 * one. This runs BEFORE the catalog row is written, and its failure aborts the
 * save: the stored amount and the amount Stripe actually bills can then never
 * disagree, which is the entire point of the sync.
 *
 * Returns the id to persist — the untouched current one when nothing about the
 * money changed, so a rename or a sortOrder edit costs no Stripe call.
 *
 * The replaced Price is archived, never deleted. Stripe keeps billing existing
 * subscriptions on an archived Price, which IS the grandfathering the operator
 * asked for: only new subscribers land on the new amount.
 */
const syncStripePrice = async (input: {
  stripe: StripeClient;
  log: FastifyBaseLogger;
  currentPriceId: string | null;
  currentAmountCents: number | null;
  currentCurrency: string | null;
  amountCents: number;
  currency: string;
  interval: 'month' | 'year';
  productName: string;
}): Promise<string> => {
  const { stripe, log, currentPriceId, amountCents, currency } = input;

  if (
    currentPriceId &&
    input.currentAmountCents === amountCents &&
    input.currentCurrency === currency
  ) {
    return currentPriceId;
  }

  // Reuse the Product the old Price hung off so repeated edits do not leave one
  // Product per edit behind. A failed lookup is NOT fatal: it only costs us the
  // reuse, and creating a fresh Product still produces a correct Price. If
  // Stripe is genuinely down, the create below fails and aborts the save.
  let productId: string | null = null;
  if (currentPriceId) {
    try {
      const existing = await stripe.retrievePrice(currentPriceId);
      productId =
        typeof existing.product === 'string'
          ? existing.product
          : 'id' in existing.product
            ? existing.product.id
            : null;
    } catch (err) {
      log.warn(
        { err, priceId: currentPriceId },
        'premium catalog: could not read the replaced Price, creating a new Product',
      );
    }
  }

  const created = await stripe.createRecurringPrice({
    productId,
    productName: input.productName,
    amountCents,
    currency,
    interval: input.interval,
  });

  if (currentPriceId) {
    // Cosmetic. An un-archived leftover bills nobody and blocks nothing, so a
    // failure here must not undo a Price that is already correct.
    try {
      await stripe.archivePrice(currentPriceId);
    } catch (err) {
      log.warn(
        { err, priceId: currentPriceId },
        'premium catalog: new Price is live but archiving the old one failed',
      );
    }
  }

  return created.priceId;
};

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
  monthlyBoxBudgetCents: plan.monthlyBoxBudgetCents,
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
  payoutAmountCents: m.payoutAmountCents,
  vendorName: m.vendorName,
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
          monthlyBoxBudgetCents: input.monthlyBoxBudgetCents ?? 0,
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
    if (input.monthlyBoxBudgetCents !== undefined)
      data.monthlyBoxBudgetCents = input.monthlyBoxBudgetCents;

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

    const current = await prisma.premiumPlanPrice.findUnique({
      where: { planId_cadence: { planId: id, cadence: cadenceParsed.data } },
    });

    let stripePriceId: string;
    try {
      stripePriceId = await syncStripePrice({
        stripe: app.stripe,
        log: request.log,
        currentPriceId: current?.stripePriceId ?? null,
        currentAmountCents: current?.baseAmountCents ?? null,
        currentCurrency: current?.currency ?? null,
        amountCents: input.baseAmountCents,
        currency: input.currency,
        interval: cadenceParsed.data === 'annual' ? 'year' : 'month',
        productName: `${plan.name} ${cadenceParsed.data === 'annual' ? 'anual' : 'mensal'}`,
      });
    } catch (err) {
      request.log.error(
        { err, planId: id, cadence: cadenceParsed.data },
        'premium catalog: Stripe refused the Price, price not saved',
      );
      return reply
        .status(502)
        .send({ error: 'BadGateway', message: 'stripe rejected the price change' });
    }

    const price = await prisma.premiumPlanPrice.upsert({
      where: { planId_cadence: { planId: id, cadence: cadenceParsed.data } },
      update: {
        baseAmountCents: input.baseAmountCents,
        currency: input.currency,
        stripePriceId,
        rcProductId: input.rcProductId ?? null,
        active: input.active,
      },
      create: {
        planId: id,
        cadence: cadenceParsed.data,
        baseAmountCents: input.baseAmountCents,
        currency: input.currency,
        stripePriceId,
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

    let stripePriceId: string;
    try {
      stripePriceId = await syncStripePrice({
        stripe: app.stripe,
        log: request.log,
        currentPriceId: null,
        currentAmountCents: null,
        currentCurrency: null,
        amountCents: input.monthlyDeltaCents,
        currency: input.currency,
        // Add-on Prices are always monthly: an annual plan plus an add-on is a
        // typed 422 (mixed intervals in one subscription), so no year variant
        // can ever be reached.
        interval: 'month',
        productName: input.name,
      });
    } catch (err) {
      request.log.error(
        { err, key: input.key },
        'premium catalog: Stripe refused the module Price, module not created',
      );
      return reply
        .status(502)
        .send({ error: 'BadGateway', message: 'stripe rejected the price change' });
    }

    try {
      const created = await prisma.premiumAddonModule.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description,
          monthlyDeltaCents: input.monthlyDeltaCents,
          payoutAmountCents: input.payoutAmountCents,
          vendorName: input.vendorName ?? null,
          quotaPerCycle: input.quotaPerCycle,
          quotaUnit: input.quotaUnit,
          currency: input.currency,
          active: input.active,
          sortOrder: input.sortOrder ?? 0,
          stripePriceId,
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
    if (input.payoutAmountCents !== undefined) data.payoutAmountCents = input.payoutAmountCents;
    if (input.vendorName !== undefined) data.vendorName = input.vendorName;
    if (input.quotaPerCycle !== undefined) data.quotaPerCycle = input.quotaPerCycle;
    if (input.quotaUnit !== undefined) data.quotaUnit = input.quotaUnit;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.rcProductId !== undefined) data.rcProductId = input.rcProductId;

    // Mint on every patch, not only on a price edit: a module that still has no
    // Price attaches locally and grants its quota without Stripe ever billing
    // it (see services/billing/addons.ts). Any save should close that hole.
    try {
      data.stripePriceId = await syncStripePrice({
        stripe: app.stripe,
        log: request.log,
        currentPriceId: existing.stripePriceId,
        currentAmountCents: existing.monthlyDeltaCents,
        currentCurrency: existing.currency,
        amountCents: input.monthlyDeltaCents ?? existing.monthlyDeltaCents,
        currency: input.currency ?? existing.currency,
        interval: 'month',
        productName: input.name ?? existing.name,
      });
    } catch (err) {
      request.log.error(
        { err, moduleId: id },
        'premium catalog: Stripe refused the module Price, module not updated',
      );
      return reply
        .status(502)
        .send({ error: 'BadGateway', message: 'stripe rejected the price change' });
    }

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
