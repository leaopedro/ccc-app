import { prisma } from '@jdm/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  allocateSpotForCar,
  GarageFullError,
  reconcileGarageSpots,
} from '../../src/services/garage/index.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('allocateSpotForCar', () => {
  beforeEach(async () => {
    await resetDatabase();
    // GeneralSettings starts empty; first reconcile/upsert will create one
    // with defaultFreeGarageSpots=null (== unlimited). Set a concrete cap so
    // we can assert the GarageFullError path deterministically.
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      update: { defaultFreeGarageSpots: 1 },
      create: { id: 'general_default', defaultFreeGarageSpots: 1 },
    });
  });

  it('claims an existing default_free empty spot and reports source=default_free', async () => {
    const { user } = await createUser({ verified: true });
    await reconcileGarageSpots(user.id); // creates 1 default_free empty
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Toyota', model: 'Supra', year: 1998, nickname: 'Branco' },
    });

    const allocated = await prisma.$transaction(async (tx) =>
      allocateSpotForCar(tx, user.id, car.id),
    );

    expect(allocated.source).toBe('default_free');
    const spot = await prisma.garageSpot.findUnique({ where: { id: allocated.spotId } });
    expect(spot!.carId).toBe(car.id);
  });

  it('claims an extra spot when no default_free spots remain', async () => {
    const { user } = await createUser({ verified: true });
    // Consume the only default_free spot, then add a purchased extra.
    await reconcileGarageSpots(user.id);
    const firstCar = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'NSX', year: 1991, nickname: 'Vermelho' },
    });
    await prisma.$transaction(async (tx) => allocateSpotForCar(tx, user.id, firstCar.id));
    await prisma.garageSpot.create({
      data: { userId: user.id, source: 'purchase' },
    });

    const secondCar = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'Preto' },
    });

    const allocated = await prisma.$transaction(async (tx) =>
      allocateSpotForCar(tx, user.id, secondCar.id),
    );
    expect(allocated.source).toBe('purchase');
  });

  it('throws GarageFullError when no spots are available', async () => {
    const { user } = await createUser({ verified: true });
    await reconcileGarageSpots(user.id);
    const firstCar = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'NSX', year: 1991, nickname: 'Branco' },
    });
    await prisma.$transaction(async (tx) => allocateSpotForCar(tx, user.id, firstCar.id));
    const secondCar = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'Preto' },
    });
    await expect(
      prisma.$transaction(async (tx) => allocateSpotForCar(tx, user.id, secondCar.id)),
    ).rejects.toBeInstanceOf(GarageFullError);
  });

  it('mints a new default_free spot when freeLimit is null (unlimited)', async () => {
    await prisma.generalSettings.update({
      where: { id: 'general_default' },
      data: { defaultFreeGarageSpots: null },
    });
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Toyota', model: 'AE86', year: 1986, nickname: 'Hachi' },
    });

    const allocated = await prisma.$transaction(async (tx) =>
      allocateSpotForCar(tx, user.id, car.id),
    );
    expect(allocated.source).toBe('default_free');
    const spot = await prisma.garageSpot.findUnique({ where: { id: allocated.spotId } });
    expect(spot!.userId).toBe(user.id);
  });
});

describe('reconcileGarageSpots', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      update: { defaultFreeGarageSpots: 2 },
      create: { id: 'general_default', defaultFreeGarageSpots: 2 },
    });
  });

  it('creates default_free empties up to the freeLimit', async () => {
    const { user } = await createUser({ verified: true });
    const result = await reconcileGarageSpots(user.id);
    expect(result.freeLimit).toBe(2);
    expect(result.isUnlimited).toBe(false);
    const empties = await prisma.garageSpot.findMany({
      where: { userId: user.id, source: 'default_free', carId: null },
    });
    expect(empties).toHaveLength(2);
  });

  it('never deletes purchased or admin-granted spots', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garageSpot.create({ data: { userId: user.id, source: 'purchase' } });
    await prisma.garageSpot.create({ data: { userId: user.id, source: 'admin_grant' } });
    await prisma.generalSettings.update({
      where: { id: 'general_default' },
      data: { defaultFreeGarageSpots: 0 },
    });
    await reconcileGarageSpots(user.id);
    const remaining = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(remaining.map((s) => s.source).sort()).toEqual(['admin_grant', 'purchase']);
  });
});
