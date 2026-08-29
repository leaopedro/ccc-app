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
  premiumPlanDetailResponseSchema,
  premiumPlanListResponseSchema,
} from '@ccc/shared/premium-catalog';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { premiumCatalogRoutes } from '../../src/routes/premium-catalog.js';
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
    const { plan } = premiumPlanDetailResponseSchema.parse(res.json());
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

describe('platform gate on the catalog reads', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();
    await seedPlan({
      tier: 'gold',
      slug: 'fundador',
      name: 'Fundador',
      prices: [{ cadence: 'monthly', baseAmountCents: 24990 }],
      benefits: [{ label: 'Acesso ao clube 24 horas', sortOrder: 1 }],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports the gate as off for iOS and on for web', async () => {
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    const gated = await makeApp();
    try {
      const ios = await gated.inject({
        method: 'GET',
        url: '/api/plans',
        headers: { 'x-ccc-platform': 'ios' },
      });
      expect(ios.json().subscriptionsEnabled).toBe(false);

      const web = await gated.inject({
        method: 'GET',
        url: '/api/plans',
        headers: { 'x-ccc-platform': 'web' },
      });
      expect(web.json().subscriptionsEnabled).toBe(true);
    } finally {
      delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
      await gated.close();
    }
  });

  it('wraps the single-plan response and carries the gate', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plans/fundador',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: { slug: 'fundador' },
      subscriptionsEnabled: true,
    });
  });

  it('carries the gate on the addon modules read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-modules',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(res.json()).toHaveProperty('subscriptionsEnabled', true);
  });

  // A cache in front of the API that ignores the header would serve a web body
  // to an iOS client. That is the exact rejection the gate exists to prevent.
  it('marks the response as varying on the platform header and uncacheable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plans',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(res.headers.vary).toContain('x-ccc-platform');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  // @fastify/cors is registered ahead of this plugin in app.ts and, when
  // CORS_ORIGINS is non-empty, adds `Vary: Origin` via its own onRequest
  // hook. `reply.header('Vary', ...)` REPLACES rather than appends, so a
  // naive hook here would silently drop the CORS entry. This test forces
  // CORS_ORIGINS on for one app instance (the default test env leaves it
  // empty — see test/setup.ts — which disables CORS entirely and means it
  // never sets Vary at all) and asserts both entries survive.
  it('preserves an existing Vary: Origin set by CORS alongside x-ccc-platform', async () => {
    process.env.CORS_ORIGINS = 'https://example.com';
    const corsEnabled = await makeApp();
    try {
      const res = await corsEnabled.inject({
        method: 'GET',
        url: '/api/plans',
        headers: { 'x-ccc-platform': 'web', origin: 'https://example.com' },
      });
      const vary = (res.headers.vary ?? '')
        .toString()
        .split(',')
        .map((part) => part.trim().toLowerCase());
      expect(vary).toContain('origin');
      expect(vary).toContain('x-ccc-platform');
      expect(res.headers['cache-control']).toContain('no-store');
    } finally {
      delete process.env.CORS_ORIGINS;
      await corsEnabled.close();
    }
  });

  // Guards the dedup branch of the onSend hook itself: if x-ccc-platform is
  // already present on Vary by the time our hook runs, it must not be
  // appended a second time. In production only CORS precedes this plugin's
  // hook (covered above, and it only ever adds `Origin`), so a bare Fastify
  // instance is used here to plant `Vary: x-ccc-platform` via an onSend hook
  // registered ahead of the real premiumCatalogRoutes plugin — still a real
  // request going through the real route/hook code, just without the rest of
  // the app.ts stack.
  it('does not duplicate x-ccc-platform when Vary already lists it', async () => {
    const standalone = Fastify();
    standalone.decorateRequest('subscriptionsEnabled', true);
    standalone.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Vary', 'x-ccc-platform');
      return payload;
    });
    await standalone.register(premiumCatalogRoutes);
    try {
      const res = await standalone.inject({ method: 'GET', url: '/api/plans' });
      expect(res.statusCode).toBe(200);
      expect(res.headers.vary).toBe('x-ccc-platform');
    } finally {
      await standalone.close();
    }
  });

  it('still 404s an unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plans/nao-existe' });
    expect(res.statusCode).toBe(404);
  });
});
