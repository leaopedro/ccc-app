import { healthResponseSchema } from '@jdm/shared/health';
import type { FastifyPluginAsync } from 'fastify';

// eslint-disable-next-line @typescript-eslint/require-await
export const healthRoutes: FastifyPluginAsync = async (app) => {
  // eslint-disable-next-line @typescript-eslint/require-await
  app.get('/health', async () => {
    const payload = {
      status: 'ok' as const,
      sha: app.env.GIT_SHA,
      uptimeSeconds: Math.round(process.uptime()),
    };
    return healthResponseSchema.parse(payload);
  });
};
