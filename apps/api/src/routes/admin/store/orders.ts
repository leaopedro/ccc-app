import {
  adminStoreOrderDetailSchema,
  adminStoreOrderListResponseSchema,
  adminStoreOrderQuerySchema,
} from '@jdm/shared/admin';
import { adminStoreFulfillmentUpdateSchema } from '@jdm/shared/store';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  FulfillmentTransitionError,
  OrderNotEligibleError,
  OrderNotFoundError,
  getAdminStoreOrderDetail,
  listAdminStoreOrders,
  updateAdminStoreFulfillment,
} from '../../../services/store/orders.js';

const paramsSchema = z.object({ id: z.string().min(1) });

// eslint-disable-next-line @typescript-eslint/require-await
export const adminStoreOrderRoutes: FastifyPluginAsync = async (app) => {
  app.get('/store/orders', async (request) => {
    const query = adminStoreOrderQuerySchema.parse(request.query);
    const result = await listAdminStoreOrders(query);
    return adminStoreOrderListResponseSchema.parse(result);
  });

  app.get('/store/orders/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    try {
      const detail = await getAdminStoreOrderDetail(id, app.env.FIELD_ENCRYPTION_KEY);
      return adminStoreOrderDetailSchema.parse(detail);
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: 'NotFound', message: err.message });
      }
      if (err instanceof OrderNotEligibleError) {
        return reply.code(404).send({ error: 'NotFound', message: err.message });
      }
      throw err;
    }
  });

  app.patch('/store/orders/:id/fulfillment', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = adminStoreFulfillmentUpdateSchema.parse(request.body);
    const actorId = (request.user as { sub?: string } | undefined)?.sub;
    if (!actorId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'no actor' });
    }
    try {
      const detail = await updateAdminStoreFulfillment(
        { ...body, actorId, orderId: id },
        app.env.FIELD_ENCRYPTION_KEY,
      );
      return adminStoreOrderDetailSchema.parse(detail);
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        return reply.code(404).send({ error: 'NotFound', message: err.message });
      }
      if (err instanceof OrderNotEligibleError) {
        return reply.code(409).send({ error: 'Conflict', message: err.message });
      }
      if (err instanceof FulfillmentTransitionError) {
        return reply.code(409).send({ error: 'InvalidTransition', message: err.message });
      }
      throw err;
    }
  });
};
