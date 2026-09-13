import { prisma } from '@ccc/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

/**
 * Duas rotas decidem por `Order.provider` e sao cegas a `Order.kind`. Enquanto
 * toda Order de caixa era `abacatepay`, caixa nao passava por elas por
 * ACIDENTE: o ramo AbacatePay do resume exige `expiresAt` (que caixa nunca
 * tem) e o refund do admin recusa tudo que nao e stripe. Com o checkout por
 * cartao, `provider` vira `stripe` e as duas portas abrem sozinhas.
 */
describe('guardas de kind nas rotas chaveadas por provider', () => {
  let ctx: Awaited<ReturnType<typeof makeAppWithFakeStripe>>;

  beforeAll(async () => {
    ctx = await makeAppWithFakeStripe();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    ctx.stripe.calls.length = 0;
  });

  const seedBoxOrder = async (status: 'pending' | 'paid') => {
    const { user } = await createUser({ email: 'box-guard@jdm.test', verified: true });
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
      select: { id: true },
    });
    return { user, orderId: order.id };
  };

  it('resume recusa uma order de caixa mesmo com provider stripe', async () => {
    const { user, orderId } = await seedBoxOrder('pending');

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(409);
    // Nunca deve tocar a Stripe: a caixa tem o proprio checkout, com validacao
    // de assinatura ativa e a guarda de box_locked nos 60s antes do corte.
    expect(ctx.stripe.calls.filter((c) => c.kind === 'retrievePaymentIntent')).toHaveLength(0);
  });

  it('resume continua funcionando para uma order de ingresso', async () => {
    const { user } = await createUser({ email: 'ticket-resume@jdm.test', verified: true });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'ticket',
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_ticket_1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    ctx.stripe.nextRetrievedPaymentIntent = {
      id: 'pi_ticket_1',
      clientSecret: 'pi_ticket_1_secret',
    };

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/orders/${order.id}/resume`,
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().clientSecret).toBe('pi_ticket_1_secret');
  });

  it('o admin recusa estornar uma order de caixa', async () => {
    const { orderId } = await seedBoxOrder('paid');
    const { user: admin } = await createUser({
      email: 'box-guard-admin@jdm.test',
      role: 'admin',
      verified: true,
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
      payload: { reason: 'tentativa de estorno de caixa pelo admin' },
    });

    // Estorno de caixa e Fase 4c. Deixar funcionar pela metade seria pior:
    // revokeTicketsForRefundedOrder nao tem ramo de box, entao a Order viraria
    // `refunded` e a caixa seria enviada do mesmo jeito.
    expect(res.statusCode).toBe(501);
    expect(ctx.stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(0);
  });

  it('o admin continua estornando uma order de ingresso', async () => {
    const { user: buyer } = await createUser({ email: 'ticket-refund@jdm.test', verified: true });
    const { user: admin } = await createUser({
      email: 'ticket-refund-admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    const order = await prisma.order.create({
      data: {
        userId: buyer.id,
        amountCents: 12_000,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
        providerRef: 'pi_live_refundme',
      },
      select: { id: true },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${order.id}/refund`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });

    expect(res.statusCode).toBe(202);
    expect(ctx.stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(1);
  });
});
