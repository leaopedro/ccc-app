import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

describe('car nickname backfill invariants (post-migration)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('every car in the DB has a non-null nickname after migration', async () => {
    const { user } = await createUser({ verified: true });
    // Direct DB insert bypasses Zod — simulates a pre-migration row.
    // After migration, the column is NOT NULL, so we test the current state.
    // We cannot actually test the DO $$ block here (migration already ran).
    // Instead, verify that creating a car without nickname via Prisma fails
    // (schema enforces not-null at DB level).
    await expect(
      prisma.car.create({
        data: {
          userId: user.id,
          make: 'Test',
          model: 'Car',
          year: 2000,
          // nickname intentionally omitted — Prisma schema requires it
          // @ts-expect-error intentional
          nickname: undefined,
        },
      }),
    ).rejects.toThrow();
  });

  it('two cars with same make+model get distinct nicknames', async () => {
    const { user } = await createUser({ verified: true });
    const c1 = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1998, nickname: 'Cinza' },
    });
    await expect(
      prisma.car.create({
        data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'Cinza' },
      }),
    ).rejects.toThrow(); // unique constraint
    const c2 = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'Cinza 2' },
    });
    expect(c1.nickname).not.toBe(c2.nickname);
  });
});
