import { prisma } from '@ccc/db';
import type { XpReason } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

// `createUser()` already mints a Garage for the user (signup-hook + migration
// backfill invariant; see helpers.ts). `Garage.userId` is unique, so tests
// MUST reuse that garage via `findUniqueOrThrow({ where: { userId } })`
// instead of calling `prisma.garage.create()` a second time (P2002).
const garageFor = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

describe('schema: Garage XP columns + XpEvent table (chunk 23)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('defaults Garage.xp and Garage.likesReceived to 0 on insert', async () => {
    const { user } = await createUser({ email: 'xp1@jdm.test' });
    const garage = await garageFor(user.id);
    expect(garage.xp).toBe(0);
    expect(garage.likesReceived).toBe(0);
  });

  it('persists xp + likesReceived increments atomically', async () => {
    const { user } = await createUser({ email: 'xp2@jdm.test' });
    const garage = await garageFor(user.id);
    const updated = await prisma.garage.update({
      where: { id: garage.id },
      data: { xp: { increment: 5 }, likesReceived: { increment: 3 } },
    });
    expect(updated.xp).toBe(5);
    expect(updated.likesReceived).toBe(3);
  });

  it('accepts XpEvent rows for all 7 XpReason enum values', async () => {
    const { user } = await createUser({ email: 'xp3@jdm.test' });
    const garage = await garageFor(user.id);

    const reasons: XpReason[] = [
      'event_checkin',
      'car_create',
      'post_create',
      'post_like',
      'badge_award',
      'premium_activation',
      'admin_adjustment',
    ];
    for (const [i, reason] of reasons.entries()) {
      await prisma.xpEvent.create({
        data: {
          garageId: garage.id,
          delta: 1,
          reason,
          sourceRef: `seed:${reason}:${i}`,
        },
      });
    }
    const count = await prisma.xpEvent.count({ where: { garageId: garage.id } });
    expect(count).toBe(7);
  });

  it('rejects duplicate (garageId, reason, sourceRef) with P2002 (§C1 DB-enforced unique)', async () => {
    const { user } = await createUser({ email: 'xp4@jdm.test' });
    const garage = await garageFor(user.id);

    await prisma.xpEvent.create({
      data: {
        garageId: garage.id,
        delta: 1,
        reason: 'post_like',
        sourceRef: 'post:abc:reaction:r1',
      },
    });

    await expect(
      prisma.xpEvent.create({
        data: {
          garageId: garage.id,
          delta: 1,
          reason: 'post_like',
          sourceRef: 'post:abc:reaction:r1',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows admin_adjustment with negative delta (sign rules are application-level)', async () => {
    const { user } = await createUser({ email: 'xp5@jdm.test' });
    const garage = await garageFor(user.id);
    const row = await prisma.xpEvent.create({
      data: {
        garageId: garage.id,
        delta: -50,
        reason: 'admin_adjustment',
        sourceRef: `admin:adm_1:${Date.now()}`,
      },
    });
    expect(row.delta).toBe(-50);
  });

  it('cascades XpEvent rows when Garage is deleted', async () => {
    const { user } = await createUser({ email: 'xp6@jdm.test' });
    const garage = await garageFor(user.id);
    await prisma.xpEvent.create({
      data: {
        garageId: garage.id,
        delta: 1,
        reason: 'event_checkin',
        sourceRef: 'event:e1',
      },
    });
    await prisma.garage.delete({ where: { id: garage.id } });
    const remaining = await prisma.xpEvent.count({ where: { garageId: garage.id } });
    expect(remaining).toBe(0);
  });

  it('raw SELECT confirms post-migration defaults are physically 0 on the column', async () => {
    // Schema contract: the `DEFAULT 0` clause on `xp` + `likesReceived` is
    // applied by Postgres at insert time (and by the ALTER TABLE for any
    // pre-existing rows in a prod-shape DB). Testcontainer Postgres starts
    // empty, so we cannot literally seed a row from a prior schema version;
    // instead we assert the post-migration default contract via a raw SELECT
    // that bypasses the Prisma client's default substitution and confirms the
    // underlying column values are physically 0. The prod-shape pre-existing
    // row path is covered transitively by the `DEFAULT 0` clause in the
    // generated migration SQL (Task 2.2 expected shape) — Postgres applies
    // that default during the `ALTER TABLE ADD COLUMN` to all existing rows.
    const { user } = await createUser({ email: 'xp7@jdm.test' });
    const garage = await garageFor(user.id);
    const rows = await prisma.$queryRaw<
      Array<{ xp: number; likesReceived: number }>
    >`SELECT "xp", "likesReceived" FROM "Garage" WHERE "id" = ${garage.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.xp).toBe(0);
    expect(rows[0]!.likesReceived).toBe(0);
  });
});
