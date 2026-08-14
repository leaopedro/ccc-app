import {
  adminBoxAdvanceRequestSchema,
  adminBoxMonthlyListResponseSchema,
  adminBoxMonthlyQuerySchema,
  adminBoxPickingResponseSchema,
} from '@ccc/shared/admin-box';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  advanceBoxFulfillment,
  getAdminBoxPicking,
  listAdminBoxes,
} from '../../services/box/fulfillment.js';

const paramsSchema = z.object({ id: z.string().min(1) });

export const adminBoxFulfillmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/monthly', async (request, reply) => {
    const query = adminBoxMonthlyQuerySchema.parse(request.query);
    const result = await listAdminBoxes(query.cycleKey);
    return reply.send(adminBoxMonthlyListResponseSchema.parse(result));
  });

  app.get('/box/monthly/picking', async (request, reply) => {
    const query = adminBoxMonthlyQuerySchema.parse(request.query);
    const result = await getAdminBoxPicking(query.cycleKey);
    return reply.send(adminBoxPickingResponseSchema.parse(result));
  });

  app.post('/box/monthly/:id/fulfillment', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = adminBoxAdvanceRequestSchema.parse(request.body);
    const result = await advanceBoxFulfillment({ boxId: id, to: body.to });
    switch (result.kind) {
      case 'ok':
        return reply.send({ id, fulfillmentStatus: result.fulfillmentStatus });
      case 'not_found':
        return reply.code(404).send({ error: 'NotFound', code: 'box_not_found' });
      case 'not_ready':
        return reply.code(409).send({ error: 'Conflict', code: 'box_not_ready' });
      case 'invalid_transition':
        return reply.code(409).send({
          error: 'Conflict',
          code: 'invalid_transition',
          from: result.from,
          to: result.to,
        });
    }
  });
};
