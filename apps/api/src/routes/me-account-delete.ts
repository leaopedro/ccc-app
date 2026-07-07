import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { requestAccountDeletion } from '../services/account-deletion/request.js';

export const meAccountDeleteRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, { max: 3, timeWindow: '1 hour' });

  app.post('/me/account/delete', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const result = await requestAccountDeletion(sub);

    if (!result.ok) {
      return { status: 'deletion_scheduled' };
    }

    return { status: result.status };
  });
};
