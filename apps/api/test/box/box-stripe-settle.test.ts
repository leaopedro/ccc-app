import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const future = new Date(Date.now() + 3 * 24 * 3600_000);

/**
 * Caixa awaiting_payment com uma Order de CARTAO (provider stripe). Este estado
 * so passa a existir quando o checkout por cartao entra no ar; antes disso
 * nenhuma Order de caixa jamais foi `provider: 'stripe'`, e e exatamente por
 * isso que o webhook da Stripe nunca ganhou o catch-all que a AbacatePay tem.
 */
const seedCardBox = async (opts?: { orderStatus?: 'pending' | 'cancelled' | 'paid' }) => {
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
  const status = opts?.orderStatus ?? 'pending';
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: 2000,
      baseAmountCents: 2000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      providerRef: 'pi_box_1',
      status,
      ...(status === 'paid' ? { paidAt: new Date() } : {}),
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
      cutoffAt: future,
      budgetCentsSnapshot: 10000,
      status: 'awaiting_payment',
      orderId: order.id,
      chargeCents: 2000,
    },
  });
  return { user, order, box };
};

const paymentIntentSucceeded = (orderId: string, eventId: string, piId = 'pi_box_1') => ({
  id: eventId,
  type: 'payment_intent.succeeded' as const,
  livemode: false,
  data: { object: { id: piId, metadata: { orderId } } },
});

const post = (app: FastifyInstance, stripe: FakeStripe) =>
  app.inject({
    method: 'POST',
    url: '/stripe/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
    payload: rawJson(stripe.nextEvent),
  });

const refunds = (stripe: FakeStripe) => stripe.calls.filter((c) => c.kind === 'refund');

describe('stripe webhook: box orders', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true },
      create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, shippingFeeCents: 0 },
    });
    stripe = buildFakeStripe();
    app = await buildApp(loadEnv(), { stripe });
  });

  afterEach(async () => {
    await app.close();
  });

  it('payment_intent.succeeded liquida a caixa: order paid e box ready', async () => {
    const { order, box } = await seedCardBox();
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_ok');

    const res = await post(app, stripe);

    expect(res.statusCode).toBe(200);
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.status).toBe('paid');
    const freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(freshBox.status).toBe('ready');
    expect(refunds(stripe)).toHaveLength(0);
  });

  it('enfileira a notificacao box.paid', async () => {
    const { order } = await seedCardBox();
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_push');

    await post(app, stripe);

    expect(await prisma.notification.count({ where: { kind: 'box.paid' } })).toBe(1);
  });

  it('e idempotente: o mesmo event id duas vezes nao duplica', async () => {
    const { order } = await seedCardBox();
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_dedupe');

    const first = await post(app, stripe);
    const second = await post(app, stripe);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await prisma.notification.count({ where: { kind: 'box.paid' } })).toBe(1);
  });

  // O caso que motiva o catch-all. Sem ele: settlePaidOrder lanca
  // OrderNotPendingError, a rota so tratava `expired`, cai no throw -> 500,
  // markProcessed nunca roda, a Stripe reentrega por ~3 dias e desativa o
  // endpoint. Dinheiro entrou, nada saiu, nenhum alerta.
  it('order cancelada no corte: 200, estorno automatico, sem 500', async () => {
    const { order } = await seedCardBox({ orderStatus: 'cancelled' });
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_cancelled');

    const res = await post(app, stripe);

    expect(res.statusCode).toBe(200);
    expect(refunds(stripe)).toHaveLength(1);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.status).toBe('cancelled');
  });

  it('reentrega de uma order cancelada nao estorna duas vezes', async () => {
    const { order } = await seedCardBox({ orderStatus: 'cancelled' });
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_cancelled_retry');

    await post(app, stripe);
    const second = await post(app, stripe);

    expect(second.statusCode).toBe(200);
    expect(refunds(stripe)).toHaveLength(1);
  });

  it('order ja paga com o mesmo PI: 200, dedupe, sem estorno', async () => {
    const { order } = await seedCardBox({ orderStatus: 'paid' });
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_already_paid');

    const res = await post(app, stripe);

    expect(res.statusCode).toBe(200);
    expect(refunds(stripe)).toHaveLength(0);
  });

  // Cobranca DISTINTA na mesma Order ja paga e pagamento em dobro. O ramo Pix
  // ja flagava isso (abacatepay-webhook.ts); aqui da para estornar de verdade.
  it('order ja paga com um PI DIFERENTE: estorna o segundo', async () => {
    const { order } = await seedCardBox({ orderStatus: 'paid' });
    stripe.nextEvent = paymentIntentSucceeded(order.id, 'evt_box_double', 'pi_box_2');

    const res = await post(app, stripe);

    expect(res.statusCode).toBe(200);
    expect(refunds(stripe)).toHaveLength(1);
  });
});
