import { prisma } from '@ccc/db';
import { FRIDGE_DEVICE_ID, fridgeUnlockBodySchema } from '@ccc/shared/fridge';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { safeEqual } from '../services/fridge/safe-equal.js';

export const fridgeUnlockRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      keyGenerator: (req) => `fridge-unlock:${req.ip}`,
    });

    scoped.post('/api/fridge/unlock', async (request, reply) => {
      const apiKey = request.headers['x-api-key'];
      const expected = app.env.FRIDGE_UNLOCK_API_KEY ?? '';
      if (typeof apiKey !== 'string' || expected.length === 0 || !safeEqual(apiKey, expected)) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'invalid api key' });
      }

      // Body accepted for future user association; PII not persisted yet (LGPD).
      fridgeUnlockBodySchema.parse(request.body ?? {});

      if (!app.fridge.isOnline(FRIDGE_DEVICE_ID)) {
        await prisma.fridgeUnlockEvent.create({
          data: { deviceId: FRIDGE_DEVICE_ID, status: 'failed_offline' },
        });
        app.log.warn({ deviceId: FRIDGE_DEVICE_ID }, '[fridge-unlock] device offline');
        return reply.status(503).send({ error: 'ServiceUnavailable', message: 'device offline' });
      }

      const delivered = app.fridge.sendUnlock(FRIDGE_DEVICE_ID, app.env.FRIDGE_DEVICE_SECRET ?? '');
      if (!delivered) {
        await prisma.fridgeUnlockEvent.create({
          data: { deviceId: FRIDGE_DEVICE_ID, status: 'failed_offline' },
        });
        app.log.warn({ deviceId: FRIDGE_DEVICE_ID }, '[fridge-unlock] device offline at send');
        return reply.status(503).send({ error: 'ServiceUnavailable', message: 'device offline' });
      }
      await prisma.fridgeUnlockEvent.create({
        data: { deviceId: FRIDGE_DEVICE_ID, status: 'sent' },
      });
      app.log.info({ deviceId: FRIDGE_DEVICE_ID }, '[fridge-unlock] unlock sent');
      return reply.status(200).send({ status: 'sent', deviceId: FRIDGE_DEVICE_ID });
    });
  });
};
