import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markPreCutoverRows } from '../../src/scripts/mark-pre-cutover-orders.js';
import { createUser, resetDatabase } from '../helpers.js';

const CUTOVER = new Date('2026-09-01T00:00:00.000Z');

describe('markPreCutoverRows', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  const makeOrder = async (userId: string, createdAt: Date) =>
    prisma.order.create({
      data: {
        userId,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: createdAt,
        createdAt,
      },
      select: { id: true, livemode: true },
    });

  it('defaults new rows to livemode true', async () => {
    const { user } = await createUser({ email: 'live@jdm.test' });
    const order = await makeOrder(user.id, new Date('2026-09-02T10:00:00.000Z'));
    expect(order.livemode).toBe(true);
  });

  it('flips only rows created before the cutover instant', async () => {
    const { user } = await createUser({ email: 'cut@jdm.test' });
    const before = await makeOrder(user.id, new Date('2026-08-20T10:00:00.000Z'));
    const after = await makeOrder(user.id, new Date('2026-09-02T10:00:00.000Z'));

    const result = await markPreCutoverRows(prisma, { createdBefore: CUTOVER });
    expect(result.orders).toBe(1);

    const rows = await prisma.order.findMany({
      where: { id: { in: [before.id, after.id] } },
      select: { id: true, livemode: true },
    });
    expect(rows.find((r) => r.id === before.id)?.livemode).toBe(false);
    expect(rows.find((r) => r.id === after.id)?.livemode).toBe(true);
  });

  // A dry run that writes is worse than no dry run: it is what the operator
  // uses to decide whether the cutoff instant is right.
  it('writes nothing in dry-run mode but reports the same count', async () => {
    const { user } = await createUser({ email: 'dry@jdm.test' });
    const before = await makeOrder(user.id, new Date('2026-08-20T10:00:00.000Z'));

    const result = await markPreCutoverRows(prisma, { createdBefore: CUTOVER, dryRun: true });
    expect(result.orders).toBe(1);

    const row = await prisma.order.findUnique({
      where: { id: before.id },
      select: { livemode: true },
    });
    expect(row?.livemode).toBe(true);
  });

  it('is idempotent — a second run finds nothing left to flip', async () => {
    const { user } = await createUser({ email: 'idem@jdm.test' });
    await makeOrder(user.id, new Date('2026-08-20T10:00:00.000Z'));

    await markPreCutoverRows(prisma, { createdBefore: CUTOVER });
    const second = await markPreCutoverRows(prisma, { createdBefore: CUTOVER });
    expect(second.orders).toBe(0);
  });
});
