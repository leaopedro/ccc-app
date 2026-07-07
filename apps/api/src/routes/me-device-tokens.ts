import { prisma } from '@jdm/db';
import { registerDeviceTokenRequestSchema } from '@jdm/shared/push';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const meDeviceTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post('/me/device-tokens', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = registerDeviceTokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid body' });
    }
    const { expoPushToken, platform } = parsed.data;
    await prisma.deviceToken.upsert({
      where: { userId_expoPushToken: { userId: sub, expoPushToken } },
      create: { userId: sub, expoPushToken, platform, lastSeenAt: new Date() },
      update: { platform, lastSeenAt: new Date() },
    });
    return reply.status(200).send({ ok: true });
  });

  app.delete<{ Params: { token: string } }>(
    '/me/device-tokens/:token',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const token = decodeURIComponent(request.params.token);
      await prisma.deviceToken.deleteMany({
        where: { userId: sub, expoPushToken: token },
      });
      return reply.status(204).send();
    },
  );
};
