import { prisma } from '@jdm/db';
import { adminStoreProductPhotoCreateSchema } from '@jdm/shared/admin';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../../plugins/auth.js';
import { recordAudit } from '../../../services/admin-audit.js';
import { queueObjectDeletion } from '../../../services/uploads/deletion-queue.js';

import { serializeAdminPhoto } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStorePhotoRoutes: FastifyPluginAsync = async (app) => {
  app.post('/store/products/:productId/photos', async (request, reply) => {
    const { sub } = requireUser(request);
    const { productId } = request.params as { productId: string };
    const input = adminStoreProductPhotoCreateSchema.parse(request.body);

    if (!app.uploads.isOwnedKey(input.objectKey, sub, 'product_photo')) {
      return reply.status(400).send({ error: 'BadRequest', message: 'object key not owned' });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return reply.status(404).send({ error: 'NotFound', message: 'product' });

    const photo = await prisma.productPhoto.create({
      data: {
        productId,
        objectKey: input.objectKey,
        sortOrder: input.sortOrder,
      },
    });
    await recordAudit({
      actorId: sub,
      action: 'store.photo.add',
      entityType: 'product',
      entityId: productId,
      metadata: { photoId: photo.id, objectKey: photo.objectKey },
    });
    return reply.status(201).send(serializeAdminPhoto(photo, app.uploads));
  });

  app.delete('/store/products/:productId/photos/:photoId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { productId, photoId } = request.params as { productId: string; photoId: string };

    const photo = await prisma.productPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.productId !== productId) {
      return reply.status(404).send({ error: 'NotFound' });
    }

    await prisma.productPhoto.delete({ where: { id: photoId } });
    try {
      await queueObjectDeletion({
        objectKey: photo.objectKey,
        reason: 'product_photo_deleted',
      });
    } catch (err) {
      app.log.warn(
        { err, objectKey: photo.objectKey, photoId: photo.id, productId },
        'failed to queue product photo object for deletion',
      );
    }
    await recordAudit({
      actorId: sub,
      action: 'store.photo.remove',
      entityType: 'product',
      entityId: productId,
      metadata: { photoId, objectKey: photo.objectKey },
    });
    return reply.status(204).send();
  });
};
