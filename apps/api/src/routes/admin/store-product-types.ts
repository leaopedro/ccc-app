import { prisma } from '@jdm/db';
import { adminProductTypeCreateSchema, adminProductTypeUpdateSchema } from '@jdm/shared/admin';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

import { serializeAdminProductType } from './serializers.js';

const PRODUCT_TYPE_ROUTE = '/store/product-types';

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: string }).code === 'P2002';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStoreProductTypeRoutes: FastifyPluginAsync = async (app) => {
  app.get(PRODUCT_TYPE_ROUTE, async () => {
    const types = await prisma.productType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return {
      items: types.map((t) => serializeAdminProductType(t, t._count.products)),
    };
  });

  app.post(PRODUCT_TYPE_ROUTE, async (request, reply) => {
    const { sub } = requireUser(request);
    const input = adminProductTypeCreateSchema.parse(request.body);

    const sortOrder = input.sortOrder ?? (await prisma.productType.count());

    try {
      const created = await prisma.productType.create({
        data: { name: input.name, sortOrder },
      });
      await recordAudit({
        actorId: sub,
        action: 'product_type.create',
        entityType: 'product_type',
        entityId: created.id,
        metadata: { name: created.name },
      });
      return reply.status(201).send(serializeAdminProductType(created, 0));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'Conflict', message: 'name already exists' });
      }
      throw err;
    }
  });

  app.patch(`${PRODUCT_TYPE_ROUTE}/:id`, async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminProductTypeUpdateSchema.parse(request.body);

    const existing = await prisma.productType.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.ProductTypeUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    try {
      const updated = await prisma.productType.update({ where: { id }, data });
      const productCount = await prisma.product.count({
        where: { productTypeId: id },
      });
      await recordAudit({
        actorId: sub,
        action: 'product_type.update',
        entityType: 'product_type',
        entityId: id,
        metadata: { fields: Object.keys(input) },
      });
      return serializeAdminProductType(updated, productCount);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'Conflict', message: 'name already exists' });
      }
      throw err;
    }
  });

  app.delete(`${PRODUCT_TYPE_ROUTE}/:id`, async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.productType.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const referencingProducts = await prisma.product.count({
      where: { productTypeId: id },
    });
    if (referencingProducts > 0) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'product type is still referenced by products',
        productCount: referencingProducts,
      });
    }

    await prisma.productType.delete({ where: { id } });
    await recordAudit({
      actorId: sub,
      action: 'product_type.delete',
      entityType: 'product_type',
      entityId: id,
      metadata: { name: existing.name },
    });
    return reply.status(204).send();
  });
};
