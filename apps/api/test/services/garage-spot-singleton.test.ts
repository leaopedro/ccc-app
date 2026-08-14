import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GARAGE_SPOT_PRODUCT_SLUG,
  GARAGE_SPOT_PRODUCT_TYPE_NAME,
  GARAGE_SPOT_VARIANT_NAME,
  prisma,
} from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../../packages/db');

// SEED_GARAGE_SPOT_PRODUCT is required since 2026-08-13: the default seed no
// longer creates the garage spot product, because selling a virtual feature
// unlock through the cart is the weakest item in an App Store submission that
// charges outside IAP. The singleton machinery itself was NOT removed — a spot
// granted by a premium plan is still a valid concept — so these tests opt in
// explicitly and keep guarding it.
const runSeed = () =>
  execSync('pnpm exec tsx prisma/seed.ts', {
    cwd: dbDir,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      SEED_GARAGE_SPOT_PRODUCT: 'true',
    },
    stdio: 'pipe',
  });

describe('garage spot singleton seed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('creates exactly one productType, one product, one variant on first run', async () => {
    runSeed();
    const types = await prisma.productType.findMany({
      where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    });
    const products = await prisma.product.findMany({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    const variants = await prisma.variant.findMany({
      where: { product: { slug: GARAGE_SPOT_PRODUCT_SLUG } },
    });
    expect(types).toHaveLength(1);
    expect(products).toHaveLength(1);
    expect(products[0]!.virtual).toBe(true);
    expect(products[0]!.visibleInStore).toBe(false);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.name).toBe(GARAGE_SPOT_VARIANT_NAME);
  });

  it('does NOT create the product when the opt-in is absent', async () => {
    // Guards the 2026-08-13 retirement: the default seed must leave no
    // purchasable garage spot product behind, in any environment. Without this
    // pin, someone re-adding the unconditional call would only be caught by an
    // App Store rejection.
    execSync('pnpm exec tsx prisma/seed.ts', {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    });

    const products = await prisma.product.findMany({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    expect(products).toHaveLength(0);
  });

  it('is idempotent — running seed three times still yields a single triple', async () => {
    runSeed();
    runSeed();
    runSeed();
    const products = await prisma.product.findMany({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    const variants = await prisma.variant.findMany({
      where: { product: { slug: GARAGE_SPOT_PRODUCT_SLUG } },
    });
    expect(products).toHaveLength(1);
    expect(variants).toHaveLength(1);
  });

  it('does not overwrite admin-set basePriceCents on re-run', async () => {
    runSeed();
    await prisma.product.update({
      where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
      data: { basePriceCents: 9900 },
    });
    runSeed();
    const product = await prisma.product.findUnique({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    expect(product!.basePriceCents).toBe(9900);
  });

  it('refuses to seed when slug is squatted by a different productType', async () => {
    const otherType = await prisma.productType.create({
      data: { name: 'Vestuário', sortOrder: 0 },
    });
    await prisma.product.create({
      data: {
        slug: GARAGE_SPOT_PRODUCT_SLUG,
        title: 'Squatter',
        description: 'imposter',
        basePriceCents: 1,
        productTypeId: otherType.id,
        status: 'draft',
      },
    });
    expect(() => runSeed()).toThrow();
  });

  it('refuses to seed when the garage_spot productType is squatted by a foreign product', async () => {
    const squattedType = await prisma.productType.create({
      data: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
    });
    await prisma.product.create({
      data: {
        slug: 'foreign-squatter',
        title: 'Foreign',
        description: 'lives under garage_spot type with the wrong slug',
        basePriceCents: 1,
        productTypeId: squattedType.id,
        status: 'draft',
      },
    });
    expect(() => runSeed()).toThrow();
  });
});

describe('garage spot FK on car delete', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('SetNull preserves the spot row when a car is deleted', async () => {
    const user = await prisma.user.create({ data: { email: 'fk@jdm.test', name: 'FK' } });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'NSX', year: 2002, nickname: 'NSX FK' },
    });
    const spot = await prisma.garageSpot.create({
      data: { userId: user.id, source: 'default_free', carId: car.id },
    });

    await prisma.car.delete({ where: { id: car.id } });

    const after = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(after).not.toBeNull();
    expect(after!.carId).toBeNull();
    // Post-pivot: tier field is gone. Free vs extra is derived from source.
    expect(after!.source).toBe('default_free');
  });

  it('cascades to GarageSpot when a User is deleted', async () => {
    const user = await prisma.user.create({ data: { email: 'cascade@jdm.test', name: 'C' } });
    const spot = await prisma.garageSpot.create({
      data: { userId: user.id, source: 'default_free' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const after = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(after).toBeNull();
  });
});
