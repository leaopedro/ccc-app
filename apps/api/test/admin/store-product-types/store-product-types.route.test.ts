import { prisma } from '@jdm/db';
import { adminProductTypeListResponseSchema, adminProductTypeSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const conflictResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  productCount: z.number().int().nonnegative(),
});

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const ROUTE = '/admin/store/product-types';

const seedType = (name: string, sortOrder = 0) =>
  prisma.productType.create({ data: { name, sortOrder } });

describe('Admin store product types', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe(`GET ${ROUTE}`, () => {
    it('lists types ordered by sortOrder then name with product counts', async () => {
      await seedType('Camisetas', 1);
      const bonesType = await seedType('Bonés', 0);
      await prisma.product.create({
        data: {
          slug: 'bone-padrao',
          title: 'Boné padrão',
          description: 'd',
          basePriceCents: 5000,
          productTypeId: bonesType.id,
        },
      });
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'GET',
        url: ROUTE,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      });

      expect(res.statusCode).toBe(200);
      const body = adminProductTypeListResponseSchema.parse(res.json());
      expect(body.items.map((i) => i.name)).toEqual(['Bonés', 'Camisetas']);
      expect(body.items[0]?.productCount).toBe(1);
      expect(body.items[1]?.productCount).toBe(0);
    });

    it('rejects non-admin roles', async () => {
      const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
      const res = await app.inject({
        method: 'GET',
        url: ROUTE,
        headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe(`POST ${ROUTE}`, () => {
    it('creates a type, defaults sortOrder to current count, writes audit', async () => {
      await seedType('Camisetas', 0);
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload: { name: 'Adesivos' },
      });

      expect(res.statusCode).toBe(201);
      const body = adminProductTypeSchema.parse(res.json());
      expect(body.name).toBe('Adesivos');
      expect(body.sortOrder).toBe(1);
      expect(body.productCount).toBe(0);

      const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
      expect(audits.map((a) => a.action)).toContain('product_type.create');
    });

    it('returns 409 on duplicate name', async () => {
      await seedType('Bonés', 0);
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload: { name: 'Bonés' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects invalid payload', async () => {
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
      const res = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload: { name: '   ' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe(`PATCH ${ROUTE}/:id`, () => {
    it('renames a type and writes audit', async () => {
      const t = await seedType('Bonez', 0);
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'PATCH',
        url: `${ROUTE}/${t.id}`,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload: { name: 'Bonés' },
      });

      expect(res.statusCode).toBe(200);
      const body = adminProductTypeSchema.parse(res.json());
      expect(body.name).toBe('Bonés');

      const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
      expect(audits.map((a) => a.action)).toContain('product_type.update');
    });

    it('returns 404 for unknown id', async () => {
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
      const res = await app.inject({
        method: 'PATCH',
        url: `${ROUTE}/nope`,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 409 when renaming to an existing name', async () => {
      const a = await seedType('Bonés', 0);
      await seedType('Camisetas', 1);
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'PATCH',
        url: `${ROUTE}/${a.id}`,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload: { name: 'Camisetas' },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe(`DELETE ${ROUTE}/:id`, () => {
    it('deletes when no products reference the type', async () => {
      const t = await seedType('Adesivos', 0);
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'DELETE',
        url: `${ROUTE}/${t.id}`,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      });

      expect(res.statusCode).toBe(204);
      expect(await prisma.productType.findUnique({ where: { id: t.id } })).toBeNull();
      const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
      expect(audits.map((a) => a.action)).toContain('product_type.delete');
    });

    it('returns 409 when products still reference the type', async () => {
      const t = await seedType('Camisetas', 0);
      await prisma.product.create({
        data: {
          slug: 'camiseta-1',
          title: 'Camiseta',
          description: 'd',
          basePriceCents: 8000,
          productTypeId: t.id,
        },
      });
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });

      const res = await app.inject({
        method: 'DELETE',
        url: `${ROUTE}/${t.id}`,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      });

      expect(res.statusCode).toBe(409);
      const body = conflictResponseSchema.parse(res.json());
      expect(body.productCount).toBe(1);
      expect(await prisma.productType.findUnique({ where: { id: t.id } })).not.toBeNull();
    });

    it('returns 404 for unknown id', async () => {
      const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
      const res = await app.inject({
        method: 'DELETE',
        url: `${ROUTE}/nope`,
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
