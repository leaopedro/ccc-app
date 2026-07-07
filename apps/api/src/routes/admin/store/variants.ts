import { prisma } from '@jdm/db';
import { adminStoreVariantCreateSchema, adminStoreVariantUpdateSchema } from '@jdm/shared/admin';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../../plugins/auth.js';
import { recordAudit } from '../../../services/admin-audit.js';

import { serializeAdminVariant } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStoreVariantRoutes: FastifyPluginAsync = async (app) => {
  app.post('/store/products/:productId/variants', async (request, reply) => {
    const { sub } = requireUser(request);
    const { productId } = request.params as { productId: string };
    const input = adminStoreVariantCreateSchema.parse(request.body);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return reply.status(404).send({ error: 'NotFound', message: 'product' });

    const variant = await prisma.variant.create({
      data: {
        productId,
        name: input.name,
        sku: input.sku,
        priceCents: input.priceCents,
        quantityTotal: input.quantityTotal,
        attributes: input.attributes as Prisma.InputJsonValue,
        active: input.active,
      },
    });
    await recordAudit({
      actorId: sub,
      action: 'store.variant.create',
      entityType: 'variant',
      entityId: variant.id,
      metadata: { productId, name: variant.name },
    });
    return reply.status(201).send(serializeAdminVariant(variant, app.env.DEV_FEE_PERCENT));
  });

  app.patch('/store/variants/:id', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminStoreVariantUpdateSchema.parse(request.body);

    const existing = await prisma.variant.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    if (input.quantityTotal !== undefined && input.quantityTotal < existing.quantitySold) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'quantityTotal cannot drop below quantitySold',
      });
    }

    const data: Prisma.VariantUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.quantityTotal !== undefined) data.quantityTotal = input.quantityTotal;
    if (input.attributes !== undefined) data.attributes = input.attributes as Prisma.InputJsonValue;
    if (input.active !== undefined) data.active = input.active;

    const updated = await prisma.variant.update({ where: { id }, data });
    await recordAudit({
      actorId: sub,
      action: 'store.variant.update',
      entityType: 'variant',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return serializeAdminVariant(updated, app.env.DEV_FEE_PERCENT);
  });

  // Soft-disable when sold; hard-delete only if no sales recorded.
  app.delete('/store/variants/:id', async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };

    const existing = await prisma.variant.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    if (existing.quantitySold > 0) {
      const updated = await prisma.variant.update({
        where: { id },
        data: { active: false },
      });
      await recordAudit({
        actorId: sub,
        action: 'store.variant.disable',
        entityType: 'variant',
        entityId: id,
        metadata: { reason: 'soft-disable: quantitySold > 0' },
      });
      return reply.status(200).send(serializeAdminVariant(updated, app.env.DEV_FEE_PERCENT));
    }

    await prisma.variant.delete({ where: { id } });
    await recordAudit({
      actorId: sub,
      action: 'store.variant.delete',
      entityType: 'variant',
      entityId: id,
      metadata: { productId: existing.productId },
    });
    return reply.status(204).send();
  });
};
