/**
 * Integration tests for the premium catalog ADMIN write endpoints
 * (apps/api/src/routes/admin/premium-catalog-admin.ts). Mounted under /admin
 * behind requireRole('organizer','admin'). Testcontainers Postgres via the
 * global setup (real DB, no mocks).
 *
 * Covers: role guard, catalog read, plan create + duplicate 409, patch, soft
 * delete, price upsert, benefits replace, module create/patch/soft delete.
 */

import { prisma } from '@jdm/db';
import {
  adminPremiumAddonModuleSchema,
  adminPremiumCatalogResponseSchema,
  adminPremiumPlanSchema,
} from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const orgAuth = async () => {
  const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
  return { user, header: bearer(loadEnv(), user.id, 'organizer') };
};

const staffAuth = async () => {
  const { user } = await createUser({ email: 'staff@jdm.test', verified: true, role: 'staff' });
  return { user, header: bearer(loadEnv(), user.id, 'staff') };
};

describe('Admin premium catalog', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('role guard', () => {
    it('rejects staff with 403', async () => {
      const { header } = await staffAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/premium/catalog',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects unauthenticated with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/premium/catalog' });
      expect(res.statusCode).toBe(401);
    });

    it('allows organizer', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/premium/catalog',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminPremiumCatalogResponseSchema.parse(res.json());
      expect(body.plans).toEqual([]);
      expect(body.modules).toEqual([]);
    });
  });

  describe('GET /admin/premium/catalog', () => {
    it('returns all plans incl. inactive, with provider ids', async () => {
      const { header } = await orgAuth();
      await prisma.premiumPlan.create({
        data: {
          tier: 'gold',
          slug: 'gold',
          name: 'Gold',
          active: false,
          sortOrder: 1,
          prices: {
            create: {
              cadence: 'monthly',
              baseAmountCents: 2990,
              stripePriceId: 'price_gold_monthly',
            },
          },
          benefits: { create: [{ label: 'B', sortOrder: 1 }, { label: 'A', sortOrder: 0 }] },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/premium/catalog',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminPremiumCatalogResponseSchema.parse(res.json());
      expect(body.plans).toHaveLength(1);
      const gold = body.plans[0]!;
      expect(gold.active).toBe(false);
      expect(gold.prices[0]?.stripePriceId).toBe('price_gold_monthly');
      expect(gold.benefits.map((b) => b.label)).toEqual(['A', 'B']);
    });
  });

  describe('POST /admin/premium/plans', () => {
    it('creates a plan', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'POST',
        url: '/admin/premium/plans',
        headers: { authorization: header },
        payload: { tier: 'bronze', slug: 'bronze', name: 'Bronze', sortOrder: 0 },
      });
      expect(res.statusCode).toBe(201);
      const body = adminPremiumPlanSchema.parse(res.json());
      expect(body.tier).toBe('bronze');
      expect(body.active).toBe(true);
    });

    it('rejects duplicate tier with 409 AlreadyExists', async () => {
      const { header } = await orgAuth();
      await prisma.premiumPlan.create({ data: { tier: 'gold', slug: 'gold', name: 'Gold' } });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/premium/plans',
        headers: { authorization: header },
        payload: { tier: 'gold', slug: 'gold-2', name: 'Gold 2' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toBe('AlreadyExists');
    });

    it('rejects invalid body with 422', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'POST',
        url: '/admin/premium/plans',
        headers: { authorization: header },
        payload: { tier: 'platinum', slug: 'x', name: '' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ error: string }>().error).toBe('UnprocessableEntity');
    });
  });

  describe('PATCH /admin/premium/plans/:id', () => {
    it('updates name/description/active/sortOrder', async () => {
      const { header } = await orgAuth();
      const plan = await prisma.premiumPlan.create({
        data: { tier: 'silver', slug: 'silver', name: 'Silver' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/premium/plans/${plan.id}`,
        headers: { authorization: header },
        payload: { name: 'Prata', description: 'Plano prata', sortOrder: 5 },
      });
      expect(res.statusCode).toBe(200);
      const body = adminPremiumPlanSchema.parse(res.json());
      expect(body.name).toBe('Prata');
      expect(body.description).toBe('Plano prata');
      expect(body.sortOrder).toBe(5);
      expect(body.tier).toBe('silver');
    });

    it('returns 404 for unknown id', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/premium/plans/nope',
        headers: { authorization: header },
        payload: { name: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /admin/premium/plans/:id', () => {
    it('soft-deletes (active=false), keeps the row', async () => {
      const { header } = await orgAuth();
      const plan = await prisma.premiumPlan.create({
        data: { tier: 'gold', slug: 'gold', name: 'Gold', active: true },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/premium/plans/${plan.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const still = await prisma.premiumPlan.findUnique({ where: { id: plan.id } });
      expect(still?.active).toBe(false);
    });

    it('returns 404 for unknown id', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/premium/plans/nope',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /admin/premium/plans/:id/prices/:cadence', () => {
    it('creates then updates a price by cadence, keeps provider ids', async () => {
      const { header } = await orgAuth();
      const plan = await prisma.premiumPlan.create({
        data: { tier: 'gold', slug: 'gold', name: 'Gold' },
      });

      const create = await app.inject({
        method: 'PUT',
        url: `/admin/premium/plans/${plan.id}/prices/monthly`,
        headers: { authorization: header },
        payload: { baseAmountCents: 2990, stripePriceId: 'price_x', rcProductId: 'rc_x' },
      });
      expect(create.statusCode).toBe(200);
      expect(create.json<{ stripePriceId: string }>().stripePriceId).toBe('price_x');

      const update = await app.inject({
        method: 'PUT',
        url: `/admin/premium/plans/${plan.id}/prices/monthly`,
        headers: { authorization: header },
        payload: { baseAmountCents: 3990 },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json<{ baseAmountCents: number }>().baseAmountCents).toBe(3990);

      const count = await prisma.premiumPlanPrice.count({ where: { planId: plan.id } });
      expect(count).toBe(1);
    });

    it('returns 422 for an invalid cadence', async () => {
      const { header } = await orgAuth();
      const plan = await prisma.premiumPlan.create({
        data: { tier: 'gold', slug: 'gold', name: 'Gold' },
      });
      const res = await app.inject({
        method: 'PUT',
        url: `/admin/premium/plans/${plan.id}/prices/weekly`,
        headers: { authorization: header },
        payload: { baseAmountCents: 2990 },
      });
      expect(res.statusCode).toBe(422);
    });

    it('returns 404 for unknown plan', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PUT',
        url: '/admin/premium/plans/nope/prices/monthly',
        headers: { authorization: header },
        payload: { baseAmountCents: 2990 },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /admin/premium/plans/:id/benefits', () => {
    it('replaces the full benefit list', async () => {
      const { header } = await orgAuth();
      const plan = await prisma.premiumPlan.create({
        data: {
          tier: 'gold',
          slug: 'gold',
          name: 'Gold',
          benefits: { create: [{ label: 'Old', sortOrder: 0 }] },
        },
      });
      const res = await app.inject({
        method: 'PUT',
        url: `/admin/premium/plans/${plan.id}/benefits`,
        headers: { authorization: header },
        payload: {
          benefits: [
            { label: 'Novo A', sortOrder: 0 },
            { label: 'Novo B', sortOrder: 1 },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ benefits: { label: string }[] }>();
      expect(body.benefits.map((b) => b.label)).toEqual(['Novo A', 'Novo B']);

      const rows = await prisma.premiumPlanBenefit.findMany({ where: { planId: plan.id } });
      expect(rows).toHaveLength(2);
    });

    it('accepts an empty list (clears benefits)', async () => {
      const { header } = await orgAuth();
      const plan = await prisma.premiumPlan.create({
        data: {
          tier: 'gold',
          slug: 'gold',
          name: 'Gold',
          benefits: { create: [{ label: 'Old', sortOrder: 0 }] },
        },
      });
      const res = await app.inject({
        method: 'PUT',
        url: `/admin/premium/plans/${plan.id}/benefits`,
        headers: { authorization: header },
        payload: { benefits: [] },
      });
      expect(res.statusCode).toBe(200);
      const rows = await prisma.premiumPlanBenefit.count({ where: { planId: plan.id } });
      expect(rows).toBe(0);
    });
  });

  describe('addon modules', () => {
    it('creates a module', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'POST',
        url: '/admin/premium/addon-modules',
        headers: { authorization: header },
        payload: {
          key: 'wash',
          name: 'Lavagem',
          description: 'Lavagem premium',
          monthlyDeltaCents: 1990,
          quotaPerCycle: 4,
          quotaUnit: 'access',
          stripePriceId: 'price_wash',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = adminPremiumAddonModuleSchema.parse(res.json());
      expect(body.key).toBe('wash');
      expect(body.stripePriceId).toBe('price_wash');
    });

    it('rejects duplicate key with 409 AlreadyExists', async () => {
      const { header } = await orgAuth();
      await prisma.premiumAddonModule.create({
        data: {
          key: 'wash',
          name: 'Lavagem',
          description: 'x',
          monthlyDeltaCents: 1990,
          quotaPerCycle: 4,
          quotaUnit: 'access',
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/premium/addon-modules',
        headers: { authorization: header },
        payload: {
          key: 'wash',
          name: 'Outra',
          description: 'y',
          monthlyDeltaCents: 1000,
          quotaPerCycle: 1,
          quotaUnit: 'hours',
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toBe('AlreadyExists');
    });

    it('patches everything except key', async () => {
      const { header } = await orgAuth();
      const mod = await prisma.premiumAddonModule.create({
        data: {
          key: 'wash',
          name: 'Lavagem',
          description: 'x',
          monthlyDeltaCents: 1990,
          quotaPerCycle: 4,
          quotaUnit: 'access',
        },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/premium/addon-modules/${mod.id}`,
        headers: { authorization: header },
        payload: { monthlyDeltaCents: 2500, quotaUnit: 'hours', rcProductId: 'rc_wash' },
      });
      expect(res.statusCode).toBe(200);
      const body = adminPremiumAddonModuleSchema.parse(res.json());
      expect(body.monthlyDeltaCents).toBe(2500);
      expect(body.quotaUnit).toBe('hours');
      expect(body.rcProductId).toBe('rc_wash');
      expect(body.key).toBe('wash');
    });

    it('soft-deletes a module (active=false)', async () => {
      const { header } = await orgAuth();
      const mod = await prisma.premiumAddonModule.create({
        data: {
          key: 'wash',
          name: 'Lavagem',
          description: 'x',
          monthlyDeltaCents: 1990,
          quotaPerCycle: 4,
          quotaUnit: 'access',
          active: true,
        },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/premium/addon-modules/${mod.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const still = await prisma.premiumAddonModule.findUnique({ where: { id: mod.id } });
      expect(still?.active).toBe(false);
    });

    it('returns 404 patching an unknown module', async () => {
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/premium/addon-modules/nope',
        headers: { authorization: header },
        payload: { name: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
