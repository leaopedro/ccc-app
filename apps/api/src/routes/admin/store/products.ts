import { prisma } from '@ccc/db';
import {
  adminStoreProductCreateSchema,
  adminStoreProductListResponseSchema,
  adminStoreProductLookupResponseSchema,
  adminStoreProductUpdateSchema,
} from '@ccc/shared/admin';
import { GARAGE_SPOT_PRODUCT_SLUG } from '@ccc/shared/garage';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

// Singleton product slugs whose lifecycle is owned by seeds. Admin PATCH must
// not change their status (mirrors UI guard in apps/admin product-form.tsx
// and assertVirtualSingletonProtected in @ccc/db for delete/duplicate).
const SINGLETON_PRODUCT_SLUGS = new Set<string>([GARAGE_SPOT_PRODUCT_SLUG]);

import { requireUser } from '../../../plugins/auth.js';
import { recordAudit } from '../../../services/admin-audit.js';

import { serializeAdminProductDetail } from './serializers.js';

const productInclude = {
  variants: true,
  photos: true,
  productType: { select: { name: true } },
} as const;

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStoreProductRoutes: FastifyPluginAsync = async (app) => {
  app.get('/store/products', async () => {
    const products = await prisma.product.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        productType: { select: { id: true, name: true } },
        _count: { select: { variants: true, photos: true } },
      },
    });
    return adminStoreProductListResponseSchema.parse({
      items: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        status: p.status,
        basePriceCents: p.basePriceCents,
        currency: p.currency,
        productTypeId: p.productTypeId,
        productTypeName: p.productType.name,
        virtual: p.virtual,
        visibleInStore: p.visibleInStore,
        variantCount: p._count.variants,
        photoCount: p._count.photos,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  });

  app.post('/store/products', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = adminStoreProductCreateSchema.parse(request.body);

    const productType = await prisma.productType.findUnique({
      where: { id: input.productTypeId },
      select: { id: true },
    });
    if (!productType) {
      return reply
        .status(400)
        .send({ error: 'BadRequest', message: 'productTypeId does not exist' });
    }

    try {
      const product = await prisma.product.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          productTypeId: input.productTypeId,
          basePriceCents: input.basePriceCents,
          currency: input.currency,
          allowPickup: input.allowPickup,
          allowShip: input.allowShip,
          shippingFeeCents: input.shippingFeeCents ?? null,
          status: 'draft',
        },
        include: productInclude,
      });
      await recordAudit({
        actorId: sub,
        action: 'store.product.create',
        entityType: 'product',
        entityId: product.id,
        metadata: { slug: product.slug },
      });
      return reply
        .status(201)
        .send(serializeAdminProductDetail(product, app.uploads, app.env.DEV_FEE_PERCENT));
    } catch (e) {
      const err = e as Prisma.PrismaClientKnownRequestError;
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'slug already exists' });
      }
      throw e;
    }
  });

  app.get('/store/products/lookup', async () => {
    const products = await prisma.product.findMany({
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      select: { id: true, slug: true, title: true, status: true },
    });
    return adminStoreProductLookupResponseSchema.parse({ items: products });
  });

  app.get('/store/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) return reply.status(404).send({ error: 'NotFound' });
    return serializeAdminProductDetail(product, app.uploads, app.env.DEV_FEE_PERCENT);
  });

  app.patch('/store/products/:id', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminStoreProductUpdateSchema.parse(request.body);

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    if (SINGLETON_PRODUCT_SLUGS.has(existing.slug)) {
      if (input.status !== undefined && input.status !== existing.status) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'singleton product status is managed by the system and cannot be changed',
        });
      }
      if (input.productTypeId !== undefined && input.productTypeId !== existing.productTypeId) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'singleton product type is managed by the system and cannot be changed',
        });
      }
      // Note: `virtual` and `visibleInStore` are not in adminStoreProductUpdateSchema
      // and are stripped by zod, so they can't be patched via this endpoint. The
      // singleton's `virtual=true` / `visibleInStore=false` invariants are owned
      // by seeds and enforced by assertVirtualSingletonProtected in @ccc/db.
    }

    if (input.status === 'active' && existing.status !== 'active') {
      if (!existing.virtual) {
        const photoCount = await prisma.productPhoto.count({ where: { productId: id } });
        if (photoCount === 0) {
          return reply.status(400).send({
            error: 'BadRequest',
            message: 'product requires at least one photo to activate',
          });
        }
        const nextAllowPickup = input.allowPickup ?? existing.allowPickup;
        const nextAllowShip = input.allowShip ?? existing.allowShip;
        if (!nextAllowPickup && !nextAllowShip) {
          return reply.status(400).send({
            error: 'BadRequest',
            message: 'product requires at least one fulfillment method to activate',
          });
        }
      }
    }

    if (
      existing.status === 'active' &&
      !existing.virtual &&
      (input.allowPickup !== undefined || input.allowShip !== undefined)
    ) {
      const nextAllowPickup =
        input.allowPickup !== undefined ? input.allowPickup : existing.allowPickup;
      const nextAllowShip = input.allowShip !== undefined ? input.allowShip : existing.allowShip;
      if (!nextAllowPickup && !nextAllowShip) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'active product must keep at least one fulfillment method',
        });
      }
    }

    if (input.productTypeId !== undefined && input.productTypeId !== existing.productTypeId) {
      const pt = await prisma.productType.findUnique({
        where: { id: input.productTypeId },
        select: { id: true },
      });
      if (!pt) {
        return reply
          .status(400)
          .send({ error: 'BadRequest', message: 'productTypeId does not exist' });
      }
    }

    const data: Prisma.ProductUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.productTypeId !== undefined) {
      data.productType = { connect: { id: input.productTypeId } };
    }
    if (input.basePriceCents !== undefined) data.basePriceCents = input.basePriceCents;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.allowPickup !== undefined) data.allowPickup = input.allowPickup;
    if (input.allowShip !== undefined) data.allowShip = input.allowShip;
    if (input.shippingFeeCents !== undefined) data.shippingFeeCents = input.shippingFeeCents;
    let auditAction: 'store.product.update' | 'store.product.archive' | 'store.product.activate' =
      'store.product.update';
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'archived' && existing.status !== 'archived') {
        auditAction = 'store.product.archive';
      } else if (input.status === 'active' && existing.status !== 'active') {
        auditAction = 'store.product.activate';
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data,
      include: productInclude,
    });
    await recordAudit({
      actorId: sub,
      action: auditAction,
      entityType: 'product',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return serializeAdminProductDetail(updated, app.uploads, app.env.DEV_FEE_PERCENT);
  });
};
