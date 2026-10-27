import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runBoxCutoffReminderTick } from '../../src/workers/box-cutoff.js';
import { createUser, resetDatabase } from '../helpers.js';

const NOW = new Date('2026-08-01T00:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

const makeBox = async (over: { status?: string; cutoffAt: Date; withItem?: boolean }) => {
  const { user } = await createUser({
    verified: true,
    email: `u${Math.random().toString(36).slice(2, 7)}@jdm.test`,
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-07-05T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-05T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-07-05',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: over.cutoffAt,
      budgetCentsSnapshot: 10000,
      status: (over.status ?? 'open') as never,
    },
  });
  if (over.withItem) {
    const item = await prisma.boxCatalogItem.create({
      data: {
        slug: `it${Math.random().toString(36).slice(2, 7)}`,
        title: 'Adesivo',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Adesivo',
      },
    });
  }
  return { user, box };
};

const reminders = (userId: string) =>
  prisma.notification.findMany({ where: { userId, kind: 'box.cutoff_soon' } });

describe('runBoxCutoffReminderTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('warns an open box whose cutoff is inside the window', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(1);
  });

  it('does not warn a box whose cutoff is still beyond the window', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 72 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(0);
  });

  it('does not warn a box whose cutoff already passed', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() - HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(0);
  });

  it('does not warn a box that is no longer open', async () => {
    const { user } = await makeBox({
      status: 'skipped',
      cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(0);
  });

  it('warns an awaiting_payment box too', async () => {
    const { user } = await makeBox({
      status: 'awaiting_payment',
      withItem: true,
      cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(1);
  });

  it('warns once per box across repeated ticks', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    await runBoxCutoffReminderTick({ now: new Date(NOW.getTime() + HOUR_MS) });
    await runBoxCutoffReminderTick({ now: new Date(NOW.getTime() + 2 * HOUR_MS) });
    expect(await reminders(user.id)).toHaveLength(1);
  });

  it('tells an empty box apart from one that already has items', async () => {
    const { user: emptyUser } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    const { user: fullUser } = await makeBox({
      withItem: true,
      cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    });
    await runBoxCutoffReminderTick({ now: NOW });
    const [empty] = await reminders(emptyUser.id);
    const [full] = await reminders(fullUser.id);
    expect(empty?.body).toBeTruthy();
    expect(empty?.body).not.toBe(full?.body);
  });

  it('lands the member on the box screen', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    const [row] = await reminders(user.id);
    expect(row?.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
    expect(row?.data).toMatchObject({ boxId: expect.any(String) });
  });
});
