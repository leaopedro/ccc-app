import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { settlePaidOrder } from '../../src/services/orders/settle.js';
import { OrderNotPendingError } from '../../src/services/tickets/issue.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

// Seeds a premium member with a box in awaiting_payment + a pending box Order.
const seedAwaitingBox = async (chargeCents: number) => {
  const { user } = await createUser({ verified: true });
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
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: chargeCents,
      baseAmountCents: chargeCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      status: 'pending',
      shippingCents: 0,
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: 10000,
      status: 'awaiting_payment',
      orderId: order.id,
      chargeCents,
    },
  });
  return { user, order, box };
};

describe('settlePaidOrder — box', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true },
      create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, shippingFeeCents: 0 },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('settles a pending box order to paid and flips the box to ready', async () => {
    const { order, box } = await seedAwaitingBox(2000);
    const result = await settlePaidOrder(order.id, 'pix_char_1', env);
    expect(result.kind).toBe('box');
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(freshOrder.status).toBe('paid');
    expect(freshOrder.paidAt).not.toBeNull();
    expect(freshOrder.providerRef).toBe('pix_char_1');
    expect(freshBox.status).toBe('ready');
    expect(freshBox.orderId).toBe(order.id);
    expect(freshBox.fulfillmentStatus).toBe('unfulfilled');
  });

  it('is idempotent: a second settle on an already-paid order throws OrderNotPendingError', async () => {
    const { order } = await seedAwaitingBox(2000);
    await settlePaidOrder(order.id, 'pix_char_1', env);
    await expect(settlePaidOrder(order.id, 'pix_char_1', env)).rejects.toBeInstanceOf(
      OrderNotPendingError,
    );
  });

  it('never flips a cutoff-cancelled order to paid', async () => {
    const { order, box } = await seedAwaitingBox(2000);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    await prisma.monthlyBox.update({ where: { id: box.id }, data: { orderId: null } });
    await expect(settlePaidOrder(order.id, 'pix_char_1', env)).rejects.toBeInstanceOf(
      OrderNotPendingError,
    );
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.status).toBe('cancelled');
  });

  it('settles a box order and enqueues a pending box.paid notification', async () => {
    const { user, order, box } = await seedAwaitingBox(2000);
    const result = await settlePaidOrder(order.id, 'bill_paid_1', env);
    expect(result).toEqual({ kind: 'box' });
    const n = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'box.paid' },
    });
    expect(n.dedupeKey).toBe(box.id);
    expect(n.sentAt).toBeNull(); // delivered later by the worker
  });
});
