import { adminOrderDetailSchema } from '@ccc/shared/admin';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  AdminOrderNotFoundError,
  getAdminOrderDetail,
} from '../../services/orders/admin-detail.js';

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * GET /admin/orders/:id — the read that pairs with POST
 * /admin/orders/:id/refund (routes/admin/refunds.ts). Same path prefix, same
 * admin-only scope, and deliberately kind-agnostic: the refund endpoint always
 * accepted every order kind, while /admin/store/orders/:id 404s anything that
 * is not a physical store order, so ticket / extras_only / box orders had no
 * way to reach the button.
 *
 * Read-only. Nothing here mutates an order, and the response carries no
 * fulfilment fields at all, so no fulfilment workflow becomes reachable for a
 * kind that has none.
 */

export const adminOrderDetailRoutes: FastifyPluginAsync = async (app) => {
  app.get('/orders/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    try {
      const detail = await getAdminOrderDetail(id);
      return adminOrderDetailSchema.parse(detail);
    } catch (err) {
      if (err instanceof AdminOrderNotFoundError) {
        return reply.code(404).send({ error: 'NotFound', message: err.message });
      }
      throw err;
    }
  });
};
