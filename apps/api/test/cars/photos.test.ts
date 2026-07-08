import { prisma } from '@ccc/db';
import { carSchema } from '@ccc/shared/cars';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as deletionQueue from '../../src/services/uploads/deletion-queue.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('car photos', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('adds a photo when the objectKey belongs to the caller', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    const env = loadEnv();
    const objectKey = `car_photo/${user.id}/abc.jpg`;
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${car.id}/photos`,
      headers: { authorization: bearer(env, user.id) },
      payload: { objectKey, width: 1200, height: 800 },
    });
    expect(res.statusCode).toBe(201);
    const body = carSchema.parse(res.json());
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]).toMatchObject({ width: 1200, height: 800 });
    expect(body.photos[0]?.url).toContain(objectKey);
  });

  it('rejects concurrent photo uploads via unique constraint', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    const env = loadEnv();
    const post = (key: string) =>
      app.inject({
        method: 'POST',
        url: `/me/cars/${car.id}/photos`,
        headers: { authorization: bearer(env, user.id) },
        payload: { objectKey: `car_photo/${user.id}/${key}` },
      });
    const [a, b] = await Promise.all([post('a.jpg'), post('b.jpg')]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    expect(await prisma.carPhoto.count({ where: { carId: car.id } })).toBe(1);
  });

  it('rejects an objectKey not owned by caller', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: { userId: me.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${car.id}/photos`,
      headers: { authorization: bearer(env, me.id) },
      payload: { objectKey: `car_photo/${other.id}/abc.jpg` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when adding a photo to a car not owned by caller', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const theirs = await prisma.car.create({
      data: { userId: other.id, make: 'Honda', model: 'NSX', year: 1991, nickname: 'NSX' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${theirs.id}/photos`,
      headers: { authorization: bearer(env, me.id) },
      payload: { objectKey: `car_photo/${me.id}/x.jpg` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when car already has a photo', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    await prisma.carPhoto.create({
      data: { carId: car.id, objectKey: `car_photo/${user.id}/first.jpg` },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${car.id}/photos`,
      headers: { authorization: bearer(env, user.id) },
      payload: { objectKey: `car_photo/${user.id}/second.jpg` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'Conflict', message: 'car_photo_limit_reached' });
    expect(await prisma.carPhoto.count({ where: { carId: car.id } })).toBe(1);
  });

  it('cleanup migration SQL collapses 3 photos to 1', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });

    // Drop the unique index so we can insert duplicates to simulate pre-migration state
    await prisma.$executeRaw`DROP INDEX IF EXISTS "CarPhoto_carId_key"`;

    const carId = car.id;
    const uid = user.id;

    await prisma.$executeRaw`
      INSERT INTO "CarPhoto" (id, "carId", "objectKey", "sortOrder", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${carId}, ${'car_photo/' + uid + '/1.jpg'}, 0, '2026-01-01'::timestamptz, NOW()),
        (gen_random_uuid(), ${carId}, ${'car_photo/' + uid + '/2.jpg'}, 1, '2026-02-01'::timestamptz, NOW()),
        (gen_random_uuid(), ${carId}, ${'car_photo/' + uid + '/3.jpg'}, 2, '2026-03-01'::timestamptz, NOW())
    `;

    expect(await prisma.carPhoto.count({ where: { carId: car.id } })).toBe(3);

    // Run the same cleanup SQL as the migration
    await prisma.$executeRaw`
      DELETE FROM "CarPhoto"
      WHERE id NOT IN (
        SELECT DISTINCT ON ("carId") id
        FROM "CarPhoto"
        ORDER BY "carId", "createdAt" DESC
      )
    `;

    expect(await prisma.carPhoto.count({ where: { carId: car.id } })).toBe(1);

    const surviving = await prisma.carPhoto.findFirst({ where: { carId: car.id } });
    expect(surviving?.objectKey).toBe(`car_photo/${uid}/3.jpg`);

    // Restore the unique index
    await prisma.$executeRaw`CREATE UNIQUE INDEX "CarPhoto_carId_key" ON "CarPhoto"("carId")`;
  });

  it('deletes a photo on the caller\u2019s car', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    const photo = await prisma.carPhoto.create({
      data: { carId: car.id, objectKey: `car_photo/${user.id}/x.jpg` },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${car.id}/photos/${photo.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.carPhoto.count()).toBe(0);
  });

  it('keeps 204 and deletes row when queue write fails on photo delete', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    const photo = await prisma.carPhoto.create({
      data: { carId: car.id, objectKey: `car_photo/${user.id}/x.jpg` },
    });
    vi.spyOn(deletionQueue, 'queueObjectDeletion').mockRejectedValueOnce(new Error('queue down'));
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${car.id}/photos/${photo.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.carPhoto.findUnique({ where: { id: photo.id } })).toBeNull();
  });

  it('returns 404 deleting a photo that does not exist', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${car.id}/photos/nonexistent`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
  });
});
