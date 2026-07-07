import { prisma } from '@jdm/db';
import {
  adminStoreCollectionCreateSchema,
  adminStoreCollectionProductsSchema,
  adminStoreCollectionReorderSchema,
  adminStoreCollectionUpdateSchema,
} from '@jdm/shared/admin';
import { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

import { serializeAdminCollection, serializeAdminCollectionProduct } from './serializers.js';

const NOT_FOUND = { error: 'NotFound' } as const;
const SLUG_TAKEN = { error: 'SlugTaken' } as const;

const findCollectionWithCount = async (collectionId: string) => {
  const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!collection) return null;
  const productCount = await prisma.productCollection.count({ where: { collectionId } });
  return { collection, productCount };
};

const loadCollectionProducts = async (collectionId: string) => {
  const rows = await prisma.productCollection.findMany({
    where: { collectionId },
    include: { product: { select: { id: true, slug: true, title: true, status: true } } },
    orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
  });
  return rows.map((row) => serializeAdminCollectionProduct(row.product, row.sortOrder));
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminCollectionRoutes: FastifyPluginAsync = async (app) => {
  // Lightweight picker for the collection ↔ product assignment UI. The full
  // admin product CRUD (sibling JDMA-S2.1) will own /admin/store/products.
  app.get('/store/collections', async () => {
    const collections = await prisma.collection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (collections.length === 0) return { items: [] };

    const counts = await prisma.productCollection.groupBy({
      by: ['collectionId'],
      _count: { collectionId: true },
      where: { collectionId: { in: collections.map((c) => c.id) } },
    });
    const countByCollection = new Map(
      counts.map((row) => [row.collectionId, row._count.collectionId]),
    );

    return {
      items: collections.map((collection) =>
        serializeAdminCollection(collection, countByCollection.get(collection.id) ?? 0),
      ),
    };
  });

  app.get('/store/collections/:collectionId', async (request, reply) => {
    const { collectionId } = request.params as { collectionId: string };
    const found = await findCollectionWithCount(collectionId);
    if (!found) return reply.status(404).send(NOT_FOUND);
    const products = await loadCollectionProducts(collectionId);
    return {
      ...serializeAdminCollection(found.collection, found.productCount),
      products,
    };
  });

  app.post('/store/collections', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = adminStoreCollectionCreateSchema.parse(request.body);

    const sortOrder = input.sortOrder ?? (await prisma.collection.count());

    try {
      const collection = await prisma.collection.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          active: input.active,
          sortOrder,
        },
      });

      await recordAudit({
        actorId: sub,
        action: 'store.collection.create',
        entityType: 'store_collection',
        entityId: collection.id,
        metadata: { slug: collection.slug },
      });

      return reply.status(201).send(serializeAdminCollection(collection, 0));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send(SLUG_TAKEN);
      }
      throw error;
    }
  });

  app.patch('/store/collections/:collectionId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { collectionId } = request.params as { collectionId: string };
    const input = adminStoreCollectionUpdateSchema.parse(request.body);

    const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
    if (!existing) return reply.status(404).send(NOT_FOUND);

    const data: Prisma.CollectionUpdateInput = {};
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    try {
      const updated = await prisma.collection.update({ where: { id: collectionId }, data });
      const productCount = await prisma.productCollection.count({ where: { collectionId } });

      await recordAudit({
        actorId: sub,
        action: 'store.collection.update',
        entityType: 'store_collection',
        entityId: collectionId,
        metadata: { fields: Object.keys(input) },
      });

      return serializeAdminCollection(updated, productCount);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send(SLUG_TAKEN);
      }
      throw error;
    }
  });

  app.delete('/store/collections/:collectionId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { collectionId } = request.params as { collectionId: string };
    const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
    if (!existing) return reply.status(404).send(NOT_FOUND);

    await prisma.$transaction([
      prisma.productCollection.deleteMany({ where: { collectionId } }),
      prisma.collection.delete({ where: { id: collectionId } }),
    ]);

    await recordAudit({
      actorId: sub,
      action: 'store.collection.delete',
      entityType: 'store_collection',
      entityId: collectionId,
      metadata: { slug: existing.slug },
    });

    return reply.status(204).send();
  });

  app.post('/store/collections/reorder', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = adminStoreCollectionReorderSchema.parse(request.body);

    const collections = await prisma.collection.findMany({
      where: { id: { in: input.ids } },
      select: { id: true },
    });
    if (collections.length !== input.ids.length) {
      return reply.status(404).send(NOT_FOUND);
    }

    await prisma.$transaction(
      input.ids.map((id, index) =>
        prisma.collection.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await recordAudit({
      actorId: sub,
      action: 'store.collection.reorder',
      entityType: 'store_collection',
      entityId: input.ids[0]!,
      metadata: { ids: input.ids },
    });

    return reply.status(204).send();
  });

  app.put('/store/collections/:collectionId/products', async (request, reply) => {
    const { sub } = requireUser(request);
    const { collectionId } = request.params as { collectionId: string };
    const input = adminStoreCollectionProductsSchema.parse(request.body);

    const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
    if (!existing) return reply.status(404).send(NOT_FOUND);

    const ids = input.productIds;
    if (new Set(ids).size !== ids.length) {
      return reply.status(400).send({ error: 'DuplicateProduct' });
    }

    if (ids.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (products.length !== ids.length) {
        return reply.status(404).send({ error: 'ProductNotFound' });
      }
    }

    await prisma.$transaction([
      prisma.productCollection.deleteMany({ where: { collectionId } }),
      ...(ids.length > 0
        ? [
            prisma.productCollection.createMany({
              data: ids.map((productId, sortOrder) => ({ productId, collectionId, sortOrder })),
            }),
          ]
        : []),
    ]);

    await recordAudit({
      actorId: sub,
      action: 'store.collection.assign_products',
      entityType: 'store_collection',
      entityId: collectionId,
      metadata: { productIds: ids },
    });

    const products = await loadCollectionProducts(collectionId);
    const productCount = products.length;
    return {
      ...serializeAdminCollection(existing, productCount),
      products,
    };
  });
};
