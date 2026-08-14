import { prisma } from '@ccc/db';
import { adminBoxMonthlyListResponseSchema } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const orgAuth = async () => {
  const { user } = await createUser({
    email: `org-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    verified: true,
    role: 'organizer',
  });
  return { user, header: bearer(env, user.id, 'organizer') };
};

// Seeds a premium member with one MonthlyBox. Pass withOrder to attach a paid
// box Order so the advance path exercises the Order sync branch.
const seedBox = async (opts: {
  cycleKey?: string;
  status?: 'open' | 'awaiting_payment' | 'ready' | 'skipped' | 'cancelled';
  fulfillmentStatus?: 'unfulfilled' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  withOrder?: boolean;
  memberName?: string;
  memberEmail?: string;
  chargeCents?: number;
}) => {
  const cycleKey = opts.cycleKey ?? '2026-08-01';
  const { user } = await createUser({
    email: opts.memberEmail ?? `member-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    name: opts.memberName ?? 'Fulano',
    verified: true,
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
      currentPeriodStart: new Date(`${cycleKey}T00:00:00.000Z`),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  let orderId: string | null = null;
  if (opts.withOrder) {
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'box',
        amountCents: opts.chargeCents ?? 2000,
        baseAmountCents: opts.chargeCents ?? 2000,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: 'BRL',
        method: 'pix',
        provider: 'abacatepay',
        status: 'paid',
        paidAt: new Date(),
        shippingCents: 0,
        fulfillmentStatus: opts.fulfillmentStatus ?? 'unfulfilled',
      },
    });
    orderId = order.id;
  }
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey,
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: 10000,
      status: opts.status ?? 'ready',
      fulfillmentStatus: opts.fulfillmentStatus ?? 'unfulfilled',
      orderId,
      chargeCents: opts.chargeCents ?? 0,
    },
  });
  return { user, membership, box, orderId };
};

const advance = (app: FastifyInstance, header: string, boxId: string, to: string) =>
  app.inject({
    method: 'POST',
    url: `/admin/box/monthly/${boxId}/fulfillment`,
    headers: { authorization: header, 'content-type': 'application/json' },
    payload: { to },
  });

describe('POST /admin/box/monthly/:id/fulfillment', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('advances an Order-backed box and syncs the Order in the same transaction', async () => {
    const { box, orderId } = await seedBox({ withOrder: true, fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();

    const r1 = await advance(app, header, box.id, 'packed');
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ id: box.id, fulfillmentStatus: 'packed' });
    let freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    let freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } });
    expect(freshBox.fulfillmentStatus).toBe('packed');
    expect(freshOrder.fulfillmentStatus).toBe('packed');
    // Order.status must never be touched by advance.
    expect(freshOrder.status).toBe('paid');

    expect((await advance(app, header, box.id, 'shipped')).statusCode).toBe(200);
    expect((await advance(app, header, box.id, 'delivered')).statusCode).toBe(200);
    freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } });
    expect(freshBox.fulfillmentStatus).toBe('delivered');
    expect(freshOrder.fulfillmentStatus).toBe('delivered');
  });

  it('advances a budget-only box (no Order)', async () => {
    const { box } = await seedBox({ withOrder: false, fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await advance(app, header, box.id, 'packed');
    expect(res.statusCode).toBe(200);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.fulfillmentStatus).toBe('packed');
    expect(fresh.orderId).toBeNull();
  });

  it('rejects advancing a box that is not ready (409 box_not_ready)', async () => {
    const { box } = await seedBox({ status: 'awaiting_payment', fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await advance(app, header, box.id, 'packed');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'box_not_ready' });
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.fulfillmentStatus).toBe('unfulfilled');
  });

  it('rejects a skip-ahead transition (409 invalid_transition)', async () => {
    const { box } = await seedBox({ fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await advance(app, header, box.id, 'delivered');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'invalid_transition',
      from: 'unfulfilled',
      to: 'delivered',
    });
  });

  it('is idempotent: a second advance to the same target returns 409 invalid_transition and does not double-write', async () => {
    const { box, orderId } = await seedBox({ withOrder: true, fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    expect((await advance(app, header, box.id, 'packed')).statusCode).toBe(200);
    const res = await advance(app, header, box.id, 'packed');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'invalid_transition', from: 'packed', to: 'packed' });
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } });
    expect(fresh.fulfillmentStatus).toBe('packed');
    expect(freshOrder.fulfillmentStatus).toBe('packed');
  });

  it('returns 404 box_not_found for an unknown box id', async () => {
    const { header } = await orgAuth();
    const res = await advance(app, header, 'box_missing', 'packed');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'box_not_found' });
  });

  it('rejects staff role (403) and unauthenticated (401)', async () => {
    const { box } = await seedBox({ fulfillmentStatus: 'unfulfilled' });
    const { user: staff } = await createUser({
      email: 'staff@jdm.test',
      verified: true,
      role: 'staff',
    });
    const staffRes = await advance(app, bearer(env, staff.id, 'staff'), box.id, 'packed');
    expect(staffRes.statusCode).toBe(403);
    const anonRes = await app.inject({
      method: 'POST',
      url: `/admin/box/monthly/${box.id}/fulfillment`,
      headers: { 'content-type': 'application/json' },
      payload: { to: 'packed' },
    });
    expect(anonRes.statusCode).toBe(401);
  });
});

describe('GET /admin/box/monthly', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('defaults to the latest cycle, lists all its boxes, and counts only ready boxes', async () => {
    // Older cycle — must not be the default and its boxes must not appear.
    await seedBox({ cycleKey: '2026-07-01', status: 'ready', fulfillmentStatus: 'delivered' });
    // Target cycle: two ready (counted) + one open + one skipped (listed, not counted).
    await seedBox({ cycleKey: '2026-08-01', status: 'ready', fulfillmentStatus: 'unfulfilled' });
    await seedBox({ cycleKey: '2026-08-01', status: 'ready', fulfillmentStatus: 'packed' });
    await seedBox({ cycleKey: '2026-08-01', status: 'open', fulfillmentStatus: 'unfulfilled' });
    await seedBox({ cycleKey: '2026-08-01', status: 'skipped', fulfillmentStatus: 'unfulfilled' });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(200);
    const body = adminBoxMonthlyListResponseSchema.parse(res.json());
    expect(body.cycleKey).toBe('2026-08-01');
    expect(body.availableCycles).toEqual(['2026-08-01', '2026-07-01']);
    expect(body.boxes).toHaveLength(4); // all 2026-08-01 boxes, open/skipped included
    expect(body.counts.unfulfilled).toBe(1); // only the ready+unfulfilled box
    expect(body.counts.packed).toBe(1);
    expect(body.counts.shipped).toBe(0);
    const row = body.boxes.find((b) => b.status === 'ready' && b.fulfillmentStatus === 'packed');
    expect(row?.memberEmail).toContain('@jdm.test');
    expect(row?.orderStatus).toBeNull();
  });

  it('honours an explicit cycleKey query', async () => {
    await seedBox({ cycleKey: '2026-07-01', status: 'ready', fulfillmentStatus: 'shipped' });
    await seedBox({ cycleKey: '2026-08-01', status: 'ready', fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly?cycleKey=2026-07-01',
      headers: { authorization: header },
    });
    const body = adminBoxMonthlyListResponseSchema.parse(res.json());
    expect(body.cycleKey).toBe('2026-07-01');
    expect(body.counts.shipped).toBe(1);
    expect(body.boxes).toHaveLength(1);
  });

  it('reflects orderStatus for Order-backed boxes', async () => {
    await seedBox({
      cycleKey: '2026-08-01',
      status: 'ready',
      fulfillmentStatus: 'unfulfilled',
      withOrder: true,
      chargeCents: 2000,
    });
    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly',
      headers: { authorization: header },
    });
    const body = adminBoxMonthlyListResponseSchema.parse(res.json());
    expect(body.boxes[0]!.orderStatus).toBe('paid');
  });
});
