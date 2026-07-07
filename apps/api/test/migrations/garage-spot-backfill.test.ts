import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../../packages/db');

// Post-pivot: GarageSpot.tier is dropped. We still validate that running
// migrate deploy against an empty DB produces the documented backfill rows
// for any users + cars that pre-existed the garage tables. The OLD migration's
// DO-block references `'free'::"GarageSpotTier"` which no longer exists after
// `drop_garage_spot_tier` ran, so we cannot re-execute it standalone. Instead
// we drive the backfill through an inline SQL block that mirrors the current
// (tier-free) shape.
describe('migration: garage spot backfill (post-pivot)', () => {
  const BACKFILL_SQL = `
    DO $$
    DECLARE
      default_free INT := 1;
      current_setting INT;
      has_settings_row BOOLEAN;
    BEGIN
      UPDATE "GeneralSettings"
        SET "defaultFreeGarageSpots" = 1
        WHERE "defaultFreeGarageSpots" IS NULL;

      SELECT COUNT(*) > 0 INTO has_settings_row FROM "GeneralSettings";

      IF has_settings_row THEN
        SELECT "defaultFreeGarageSpots" INTO current_setting
          FROM "GeneralSettings" ORDER BY "createdAt" ASC LIMIT 1;
        IF current_setting IS NULL THEN
          default_free := 0;
        ELSE
          default_free := current_setting;
        END IF;
      END IF;

      INSERT INTO "GarageSpot" ("id", "userId", "source", "carId", "createdAt", "updatedAt")
      SELECT
        'gs_bf_' || c."id",
        c."userId",
        'default_free'::"GarageSpotSource",
        c."id",
        NOW(),
        NOW()
      FROM "Car" c
      WHERE NOT EXISTS (SELECT 1 FROM "GarageSpot" gs WHERE gs."carId" = c."id");

      IF default_free >= 1 THEN
        INSERT INTO "GarageSpot" ("id", "userId", "source", "carId", "createdAt", "updatedAt")
        SELECT
          'gs_bfempty_' || u."id",
          u."id",
          'default_free'::"GarageSpotSource",
          NULL,
          NOW(),
          NOW()
        FROM "User" u
        WHERE NOT EXISTS (SELECT 1 FROM "Car" c WHERE c."userId" = u."id")
          AND NOT EXISTS (
            SELECT 1 FROM "GarageSpot" gs
            WHERE gs."userId" = u."id" AND gs."carId" IS NULL AND gs."source" = 'default_free'
          );
      END IF;
    END $$;
  `;

  it('inserts one default_free spot per existing car and one empty default_free spot per car-less user', async () => {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('jdm_bf')
      .withUsername('jdm')
      .withPassword('jdm')
      .start();
    const url = container.getConnectionUri();
    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: dbDir,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });

      const fresh = new PrismaClient({ datasources: { db: { url } } });

      const userA = await fresh.user.create({
        data: {
          email: 'a@jdm.test',
          name: 'A',
          garage: {
            create: {
              name: 'Garagem',
              slug: `user-a-bf-${Date.now()}`,
            },
          },
        },
      });
      const userB = await fresh.user.create({
        data: {
          email: 'b@jdm.test',
          name: 'B',
          garage: {
            create: {
              name: 'Garagem',
              slug: `user-b-bf-${Date.now()}`,
            },
          },
        },
      });
      const car1 = await fresh.car.create({
        data: {
          userId: userA.id,
          make: 'Toyota',
          model: 'Supra',
          year: 1998,
          nickname: 'Supra BF',
        },
      });
      const car2 = await fresh.car.create({
        data: {
          userId: userA.id,
          make: 'Nissan',
          model: 'Skyline',
          year: 1999,
          nickname: 'Skyline BF',
        },
      });

      await fresh.garageSpot.deleteMany();
      await fresh.$executeRawUnsafe(BACKFILL_SQL);

      const spots = await fresh.garageSpot.findMany({ orderBy: { id: 'asc' } });
      // Filter to just our two seeded users — the migration's own backfill may
      // have created rows for any other Users `migrate deploy` produces.
      const ours = spots.filter((s) => s.userId === userA.id || s.userId === userB.id);
      expect(ours).toHaveLength(3); // 2 cars + 1 empty for car-less user

      const filled = ours.filter((s) => s.carId !== null);
      expect(filled).toHaveLength(2);
      expect(filled.map((s) => s.carId).sort()).toEqual([car1.id, car2.id].sort());
      filled.forEach((s) => {
        expect(s.source).toBe('default_free');
      });

      const empties = ours.filter((s) => s.carId === null);
      expect(empties).toHaveLength(1);
      expect(empties[0]!.userId).toBe(userB.id);
      expect(empties[0]!.source).toBe('default_free');

      // Idempotent re-run.
      await fresh.$executeRawUnsafe(BACKFILL_SQL);
      const after = await fresh.garageSpot.findMany({
        where: { userId: { in: [userA.id, userB.id] } },
      });
      expect(after).toHaveLength(3);

      await fresh.$disconnect();
    } finally {
      await container.stop();
    }
  }, 120_000);

  it('post-pivot migration creates a Garage row per existing User with neutral defaults', async () => {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('jdm_garage_bf')
      .withUsername('jdm')
      .withPassword('jdm')
      .start();
    const url = container.getConnectionUri();
    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: dbDir,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });

      const fresh = new PrismaClient({ datasources: { db: { url } } });

      // Direct-insert a User row without a Garage to simulate a pre-pivot user
      // (the DO-block in `garage_model_and_car_description` is idempotent, so
      // we exercise it by clearing the table and re-running just that block).
      await fresh.garage.deleteMany();
      const u = await fresh.user.create({ data: { email: 'pre@jdm.test', name: 'Pre' } });

      const sqlPath = path.resolve(
        dbDir,
        'prisma/migrations/20260521120300_garage_model_and_car_description/migration.sql',
      );
      const migrationSql = (await import('node:fs')).readFileSync(sqlPath, 'utf8');
      const doStart = migrationSql.indexOf('DO $$');
      const doEnd = migrationSql.indexOf('END $$;', doStart) + 'END $$;'.length;
      await fresh.$executeRawUnsafe(migrationSql.slice(doStart, doEnd));

      const garage = await fresh.garage.findUnique({ where: { userId: u.id } });
      expect(garage).not.toBeNull();
      expect(garage!.name).toBe('Garagem');
      expect(garage!.slug).toMatch(/^user-/);
      expect(garage!.isPublic).toBe(false);
      expect(garage!.premiumTier).toBeNull();
      // Slug must NOT be derived from User.name.
      expect(garage!.slug.includes('pre')).toBe(false);

      await fresh.$disconnect();
    } finally {
      await container.stop();
    }
  }, 120_000);
});
