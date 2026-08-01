import { prisma } from '@ccc/db';
import { addCarPhotoSchema, carInputSchema, carUpdateSchema } from '@ccc/shared/cars';
import { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { requireUser } from '../plugins/auth.js';
import { awardBadge } from '../services/garage/awarder.js';
import { checkEligibility as checkCarEligibility } from '../services/garage/eligibility/cars.js';
import { allocateSpotForCar, GarageFullError } from '../services/garage/index.js';
import { awardXp } from '../services/garage/xp-awarder.js';
import { queueObjectDeletion } from '../services/uploads/deletion-queue.js';

import { serializeCar } from './cars-serializer.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const carRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/cars', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const cars = await prisma.car.findMany({
      where: { userId: sub },
      include: {
        photos: true,
        user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { cars: cars.map((c) => serializeCar(c, app.uploads)) };
  });

  app.get('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const car = await prisma.car.findFirst({
      where: { id, userId: sub },
      include: {
        photos: true,
        user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
      },
    });
    if (!car) return reply.status(404).send({ error: 'NotFound' });
    return serializeCar(car, app.uploads);
  });

  app.post('/me/cars', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { make, model, year, nickname, modifications } = carInputSchema.parse(request.body);

    // Car create + spot allocation must be atomic. Serializable isolation
    // guards against concurrent allocations claiming the same empty spot
    // (allocator does a findFirst({carId:null}) then update — without
    // Serializable two requests can both see the same row and one update
    // silently overwrites the other). Retry up to 3x on P2034 conflict.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const car = await prisma.$transaction(
          async (tx) => {
            const created = await tx.car.create({
              data: {
                make,
                model,
                year,
                nickname,
                modifications,
                userId: sub,
              },
              include: {
                photos: true,
                user: {
                  select: { garage: { select: { premiumTier: true, premiumUntil: true } } },
                },
              },
            });
            await allocateSpotForCar(tx, sub, created.id);

            // Conquistas — score car-surface eligibility AFTER the new car
            // lands so CAR-001 / CAR-002 / CAR-003 see the up-to-date count.
            // The user's garage is 1:1 with the user (signup hook guarantees
            // it exists); we resolve garageId via the unique userId index.
            // Award failures are best-effort: an awarder throw would roll
            // back the entire car-create tx, which we explicitly DON'T want.
            const garage = await tx.garage.findUnique({
              where: { userId: sub },
              select: { id: true },
            });
            if (garage) {
              const codes = await checkCarEligibility(tx, sub);
              for (const code of codes) {
                try {
                  await awardBadge(tx, garage.id, code, `car:${created.id}`);
                } catch (err) {
                  // Log + swallow — the car-create is the user's primary
                  // action, not the badge grant. Surfacing the throw would
                  // break car creation if e.g. a Badge row was missing from
                  // the seed in a fresh environment.
                  app.log.warn(
                    { err, garageId: garage.id, code },
                    'awardBadge failed during car create',
                  );
                }
              }

              // XP — fire +5 for car_create on the freshly-created carId. Per
              // canon §5, the awarder owns expected-failure handling
              // (killswitch off + P2002 → { awarded: false }); any other error
              // RETHROWS so the parent tx rolls back with the car row. NO
              // try/catch here — wrapping inside the parent tx would allow
              // partial XP writes to commit on unexpected errors.
              await awardXp(tx, garage.id, 'car_create', {
                sourceRef: `car:${created.id}`,
              });
            }
            return created;
          },
          { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
        );
        return reply.status(201).send(serializeCar(car, app.uploads));
      } catch (e) {
        if (e instanceof GarageFullError) {
          return reply
            .status(409)
            .send({ error: 'Conflict', code: 'GARAGE_FULL', message: e.message });
        }
        if (isUniqueConstraintError(e)) {
          return reply.status(409).send({ error: 'nickname_taken' });
        }
        const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : '';
        if (code === 'P2034') {
          if (attempt < 2) continue;
          return reply.status(409).send({ error: 'Conflict', code: 'SERIALIZATION_CONFLICT' });
        }
        throw e;
      }
    }
    // Loop always returns or throws; this is a TS-exhaustiveness guard.
    return reply.status(500).send({ error: 'InternalServerError' });
  });

  app.patch('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const owned = await prisma.car.findFirst({ where: { id, userId: sub } });
    if (!owned) return reply.status(404).send({ error: 'NotFound' });
    const { make, model, year, nickname, modifications } = carUpdateSchema.parse(request.body);
    try {
      const updated = await prisma.car.update({
        where: { id },
        data: {
          ...(make !== undefined ? { make } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(year !== undefined ? { year } : {}),
          ...(nickname !== undefined ? { nickname } : {}),
          ...(modifications !== undefined ? { modifications } : {}),
        },
        include: {
          photos: true,
          user: {
            select: { garage: { select: { premiumTier: true, premiumUntil: true } } },
          },
        },
      });
      return serializeCar(updated, app.uploads);
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        return reply.status(409).send({ error: 'nickname_taken' });
      }
      throw e;
    }
  });

  app.delete('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const { count } = await prisma.car.deleteMany({ where: { id, userId: sub } });
    if (count === 0) return reply.status(404).send({ error: 'NotFound' });
    return reply.status(204).send();
  });

  app.post('/me/cars/:id/photos', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { id } = request.params as { id: string };
    const { objectKey, width, height } = addCarPhotoSchema.parse(request.body);
    if (!app.uploads.isOwnedKey(objectKey, sub, 'car_photo')) {
      return reply.status(400).send({ error: 'BadRequest', message: 'object key not owned' });
    }
    const car = await prisma.car.findFirst({
      where: { id, userId: sub },
      include: { photos: { select: { id: true }, take: 1 } },
    });
    if (!car) return reply.status(404).send({ error: 'NotFound' });

    if (car.photos.length > 0) {
      return reply.status(409).send({ error: 'Conflict', message: 'car_photo_limit_reached' });
    }

    try {
      await prisma.carPhoto.create({
        data: {
          carId: id,
          objectKey,
          width: width ?? null,
          height: height ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'car_photo_limit_reached' });
      }
      throw e;
    }

    const updated = await prisma.car.findUniqueOrThrow({
      where: { id },
      include: {
        photos: true,
        user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
      },
    });
    return reply.status(201).send(serializeCar(updated, app.uploads));
  });

  app.delete(
    '/me/cars/:id/photos/:photoId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { id, photoId } = request.params as { id: string; photoId: string };
      const car = await prisma.car.findFirst({ where: { id, userId: sub } });
      if (!car) return reply.status(404).send({ error: 'NotFound' });
      const photo = await prisma.carPhoto.findFirst({ where: { id: photoId, carId: id } });
      if (!photo) return reply.status(404).send({ error: 'NotFound' });
      await prisma.carPhoto.delete({ where: { id: photoId } });
      try {
        await queueObjectDeletion({
          objectKey: photo.objectKey,
          reason: 'car_photo_deleted',
        });
      } catch (err) {
        app.log.warn(
          { err, objectKey: photo.objectKey, photoId: photo.id, carId: id },
          'failed to queue car photo object for deletion',
        );
      }
      return reply.status(204).send();
    },
  );
};
