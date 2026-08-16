import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sentry is spied on to assert manual-refund flagging. ESM module namespaces
// aren't configurable, so a top-level mock is required (mirrors
// test/abacatepay/webhook.test.ts).
vi.mock('@sentry/node', () => {
  const noop = () => {};
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: (
      cb: (scope: {
        setTag: (k: string, v: unknown) => void;
        setLevel: (l: string) => void;
        setExtras: (e: Record<string, unknown>) => void;
        setExtra: (k: string, v: unknown) => void;
        setContext: (k: string, v: unknown) => void;
      }) => void,
    ) => cb({ setTag: noop, setLevel: noop, setExtras: noop, setExtra: noop, setContext: noop }),
  };
});

const Sentry = (await import('@sentry/node')) as unknown as {
  captureMessage: ReturnType<typeof vi.fn>;
};

import { buildApp } from '../../src/app.js';
import { type Env, loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay, type FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const baseEnv = loadEnv();
const TEST_WEBHOOK_SECRET = 'test-webhook-secret-abc123';
const env: Env = { ...baseEnv, ABACATEPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };

const webhookUrl = `/abacatepay/webhook?webhookSecret=${TEST_WEBHOOK_SECRET}`;

// Mirrors AbacatePay's v2 `transparent.completed` webhook shape (data nested
// under data.transparent), same as test/abacatepay/webhook.test.ts.
const makeV2TransparentCompletedPayload = (
  billingId: string,
  eventId: string,
  metadata: Record<string, string>,
) =>
  JSON.stringify({
    id: eventId,
    event: 'transparent.completed',
    apiVersion: 2,
    devMode: false,
    data: {
      transparent: {
        id: billingId,
        amount: 5000,
        paidAmount: 5000,
        status: 'PAID',
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata,
      },
    },
  });

// A paid box Order — its MonthlyBox is irrelevant here: settlePaidOrder's box
// branch throws OrderNotPendingError before ever touching MonthlyBox once
// order.status !== 'pending' (see src/services/orders/settle.ts:82-83).
const seedPaidBoxOrder = async (userId: string, providerRef: string) => {
  const order = await prisma.order.create({
    data: {
      userId,
      kind: 'box',
      amountCents: 2000,
      baseAmountCents: 2000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      providerRef,
      status: 'paid',
      paidAt: new Date(),
      shippingCents: 0,
    },
  });
  return order;
};

describe('POST /abacatepay/webhook — box double-payment hardening', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;

  beforeEach(async () => {
    await resetDatabase();
    abacatepay = buildFakeAbacatePay();
    const stripe = buildFakeStripe();
    app = await buildApp(env, { stripe, abacatepay, push: new DevPushSender() });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('flags a manual refund when a second distinct billing settles an already-paid box order', async () => {
    const { user } = await createUser({ verified: true });
    const order = await seedPaidBoxOrder(user.id, 'pix_char_A');
    Sentry.captureMessage.mockClear();

    const payload = makeV2TransparentCompletedPayload('pix_char_B', 'evt_box_double_payment_1', {
      orderId: order.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body: { ok: boolean } = res.json();
    expect(body.ok).toBe(true);

    const refundCalls = Sentry.captureMessage.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('double-payment'),
    );
    expect(refundCalls).toHaveLength(1);

    const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchangedOrder.status).toBe('paid');
    expect(unchangedOrder.providerRef).toBe('pix_char_A');

    Sentry.captureMessage.mockClear();
  });

  it('does not flag a manual refund on a benign redelivery of the same billing', async () => {
    const { user } = await createUser({ verified: true });
    const order = await seedPaidBoxOrder(user.id, 'pix_char_A');
    Sentry.captureMessage.mockClear();

    const payload = makeV2TransparentCompletedPayload('pix_char_A', 'evt_box_redelivery_1', {
      orderId: order.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body: { ok: boolean } = res.json();
    expect(body.ok).toBe(true);

    const refundCalls = Sentry.captureMessage.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('double-payment'),
    );
    expect(refundCalls).toHaveLength(0);

    const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchangedOrder.status).toBe('paid');

    Sentry.captureMessage.mockClear();
  });

  it('sends box.paid push when a pending box order settles', async () => {
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
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'box',
        amountCents: 2000,
        baseAmountCents: 2000,
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
        chargeCents: 2000,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': 'valid-sig' },
      payload: makeV2TransparentCompletedPayload('bill_box_1', 'evt_box_1', { orderId: order.id }),
    });
    expect(res.statusCode).toBe(200);

    const notif = await prisma.notification.findFirst({
      where: { userId: user.id, kind: 'box.paid' },
    });
    expect(notif?.dedupeKey).toBe(box.id);
    expect(notif?.title).toBe('Pagamento confirmado');
    expect(notif?.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
    expect(notif?.sentAt).toBeNull();
  });
});
