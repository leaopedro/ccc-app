/**
 * Integration tests for the premium catalog READ endpoints:
 *   GET /api/plans
 *   GET /api/plans/:slug
 *   GET /api/addon-modules
 *
 * Pattern mirrors premium-pricing.test.ts + store/catalog.test.ts:
 *   - Testcontainers Postgres via the global setup (real DB, no mocks).
 *   - buildApp(loadEnv()) via makeApp().
 *   - resetDatabase() between tests; the catalog tables are not covered by the
 *     shared helper, so this spec truncates them itself before seeding.
 *
 * Routes are unauthed + not flag-gated, so no auth header / env toggling here.
 */

import { prisma } from '@ccc/db';
import {
  premiumAddonModuleListResponseSchema,
  premiumPlanListResponseSchema,
  premiumPlanSchema,
} from '@ccc/shared/premium-catalog';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

type PlanSeed = {
  tier: 'bronze' | 'silver' | 'gold';
  slug: string;
  name: string;
  description?: string | null;
  active?: boolean;
  sortOrder?: number;
  prices?: {
    cadence: 'monthly' | 'annual';
    baseAmountCents: number;
    currency?: string;
    stripePriceId?: string | null;
    active?: boolean;
  }[];
  benefits?: { label: string; sortOrder: number }[];
};

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const seedPlan = (plan: PlanSeed) =>
  prisma.premiumPlan.create({
    data: {
      tier: plan.tier,
      slug: plan.slug,
      name: plan.name,
      description: plan.description ?? null,
      active: plan.active ?? true,
      sortOrder: plan.sortOrder ?? 0,
      prices: {
        create: (plan.prices ?? []).map((p) => ({
          cadence: p.cadence,
          baseAmountCents: p.baseAmountCents,
          currency: p.currency ?? 'BRL',
          stripePriceId: p.stripePriceId ?? null,
          active: p.active ?? true,
        })),
      },
      benefits: {
        create: (plan.benefits ?? []).map((b) => ({
          label: b.label,
          sortOrder: b.sortOrder,
        })),
      },
    },
  });

const seedAddonModule = (
  overrides: Partial<{
    key: string;
    name: string;
    description: string;
    monthlyDeltaCents: number;
    currency: string;
    quotaPerCycle: number;
    quotaUnit: 'access' | 'hours';
    active: boolean;
    sortOrder: number;
    stripePriceId: string | null;
  }> = {},
) =>
  prisma.premiumAddonModule.create({
    data: {
      key: overrides.key ?? `addon-${Math.random().toString(36).slice(2, 8)}`,
      name: overrides.name ?? 'Add-on',
      description: overrides.description ?? 'Descrição do módulo',
      monthlyDeltaCents: overrides.monthlyDeltaCents ?? 1990,
      currency: overrides.currency ?? 'BRL',
      quotaPerCycle: overrides.quotaPerCycle ?? 4,
      quotaUnit: overrides.quotaUnit ?? 'access',
      active: overrides.active ?? true,
      sortOrder: overrides.sortOrder ?? 0,
      stripePriceId: overrides.stripePriceId ?? null,
    },
  });

describe('GET /api/plans', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns active plans ordered by sortOrder ASC, with prices + benefits', async () => {
    await seedPlan({
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      description: 'Top tier',
      sortOrder: 2,
      prices: [
        { cadence: 'monthly', baseAmountCents: 2990 },
        { cadence: 'annual', baseAmountCents: 29900 },
      ],
      benefits: [
        { label: 'Benefício B', sortOrder: 1 },
        { label: 'Benefício A', sortOrder: 0 },
      ],
    });
    await seedPlan({
      tier: 'bronze',
      slug: 'bronze',
      name: 'Bronze',
      sortOrder: 0,
      prices: [{ cadence: 'monthly', baseAmountCents: 990 }],
    });
    await seedPlan({
      tier: 'silver',
      slug: 'silver',
      name: 'Silver',
      sortOrder: 1,
      prices: [{ cadence: 'monthly', baseAmountCents: 1990 }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/plans' });
    expect(res.statusCode).toBe(200);
    const body = premiumPlanListResponseSchema.parse(res.json());

    expect(body.plans.map((p) => p.slug)).toEqual(['bronze', 'silver', 'gold']);

    const gold = body.plans.find((p) => p.slug === 'gold');
    expect(gold?.tier).toBe('gold');
    expect(gold?.description).toBe('Top tier');
    expect(gold?.prices.map((pr) => pr.cadence).sort()).toEqual(['annual', 'monthly']);
    // Benefits ordered by sortOrder ASC.
    expect(gold?.benefits.map((b) => b.label)).toEqual(['Benefício A', 'Benefício B']);
  });

  it('omits inactive plans', async () => {
    await seedPlan({ tier: 'gold', slug: 'gold', name: 'Gold', active: true, sortOrder: 0 });
    await seedPlan({ tier: 'silver', slug: 'silver', name: 'Silver', active: false, sortOrder: 1 });

    const res = await app.inject({ method: 'GET', url: '/api/plans' });
    expect(res.statusCode).toBe(200);
    const body = premiumPlanListResponseSchema.parse(res.json());
    expect(body.plans.map((p) => p.slug)).toEqual(['gold']);
  });

  it('excludes inactive prices from a plan', async () => {
    await seedPlan({
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      sortOrder: 0,
      prices: [
        { cadence: 'monthly', baseAmountCents: 2990, active: true },
        { cadence: 'annual', baseAmountCents: 29900, active: false },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/plans' });
    const body = premiumPlanListResponseSchema.parse(res.json());
    expect(body.plans[0]?.prices.map((pr) => pr.cadence)).toEqual(['monthly']);
  });

  it('never exposes provider price ids', async () => {
    await seedPlan({
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      sortOrder: 0,
      prices: [{ cadence: 'monthly', baseAmountCents: 2990, stripePriceId: 'price_secret_123' }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/plans' });
    expect(res.payload).not.toContain('price_secret_123');
    expect(res.payload).not.toContain('stripePriceId');
  });

  it('returns an empty list when no plans exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plans' });
    expect(res.statusCode).toBe(200);
    const body = premiumPlanListResponseSchema.parse(res.json());
    expect(body.plans).toEqual([]);
  });
});

describe('GET /api/plans/:slug', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a single active plan by slug with prices + benefits', async () => {
    await seedPlan({
      tier: 'gold',
      slug: 'gold',
      name: 'Gold',
      description: 'Top tier',
      sortOrder: 0,
      prices: [{ cadence: 'monthly', baseAmountCents: 2990 }],
      benefits: [{ label: 'Único', sortOrder: 0 }],
    });

    const res = await app.inject({ method: 'GET', url: '/api/plans/gold' });
    expect(res.statusCode).toBe(200);
    const plan = premiumPlanSchema.parse(res.json());
    expect(plan.slug).toBe('gold');
    expect(plan.tier).toBe('gold');
    expect(plan.prices).toHaveLength(1);
    expect(plan.benefits).toHaveLength(1);
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plans/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('NotFound');
  });

  it('returns 404 when the plan exists but is inactive', async () => {
    await seedPlan({ tier: 'gold', slug: 'gold', name: 'Gold', active: false, sortOrder: 0 });
    const res = await app.inject({ method: 'GET', url: '/api/plans/gold' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/addon-modules', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns active modules ordered by sortOrder ASC', async () => {
    await seedAddonModule({ key: 'wash', name: 'Lavagem', sortOrder: 2, quotaUnit: 'access' });
    await seedAddonModule({ key: 'lounge', name: 'Lounge', sortOrder: 0, quotaUnit: 'hours' });
    await seedAddonModule({ key: 'storage', name: 'Estoque', sortOrder: 1, quotaUnit: 'hours' });

    const res = await app.inject({ method: 'GET', url: '/api/addon-modules' });
    expect(res.statusCode).toBe(200);
    const body = premiumAddonModuleListResponseSchema.parse(res.json());
    expect(body.modules.map((m) => m.key)).toEqual(['lounge', 'storage', 'wash']);
  });

  it('omits inactive modules', async () => {
    await seedAddonModule({ key: 'active-one', sortOrder: 0, active: true });
    await seedAddonModule({ key: 'inactive-one', sortOrder: 1, active: false });

    const res = await app.inject({ method: 'GET', url: '/api/addon-modules' });
    const body = premiumAddonModuleListResponseSchema.parse(res.json());
    expect(body.modules.map((m) => m.key)).toEqual(['active-one']);
  });

  it('never exposes provider price ids', async () => {
    await seedAddonModule({ key: 'wash', stripePriceId: 'price_secret_addon' });
    const res = await app.inject({ method: 'GET', url: '/api/addon-modules' });
    expect(res.payload).not.toContain('price_secret_addon');
    expect(res.payload).not.toContain('stripePriceId');
  });
});
