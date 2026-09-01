import { prisma } from '@ccc/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /admin/orders/:id/refund', () => {
  let ctx: Awaited<ReturnType<typeof makeAppWithFakeStripe>>;
  let adminAuth: string;
  let orderId: string;

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

    const { user: admin } = await createUser({
      email: 'refund-admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    adminAuth = bearer(env, admin.id, 'admin');

    const { user: buyer } = await createUser({ email: 'refund-buyer@jdm.test', verified: true });
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
    orderId = order.id;
  });

  it('asks Stripe for the refund and returns 202', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    expect(res.statusCode).toBe(202);
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(true);
  });

  it('sends the payment intent id, reason and no amount for a full refund', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    const call = ctx.stripe.calls.find((c) => c.kind === 'refund');
    expect(call?.payload).toMatchObject({
      paymentIntentId: 'pi_live_refundme',
      reason: 'cliente desistiu dentro dos sete dias',
    });
  });

  // Load-bearing. The webhook owns the status column. If this route wrote it
  // too, "was this refunded" would have two answers that can disagree.
  it('does NOT flip the order status itself', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    expect(row.status).toBe('paid');
  });

  it('records an audit row with the reason', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'order.refund_requested' },
      select: { entityId: true, metadata: true },
    });
    expect(audit?.entityId).toBe(orderId);
    expect(JSON.stringify(audit?.metadata)).toContain('sete dias');
  });

  it('422s an order that is not paid', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'pending' } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'tentativa em pedido nao pago' },
    });
    expect(res.statusCode).toBe(422);
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(false);
  });

  // AbacatePay documents no refund API. Answering 501 with the manual path is
  // honest; pretending to refund is not.
  it('501s a Pix order and names the manual path', async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: { provider: 'abacatepay', method: 'pix' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'pix precisa de suporte do fornecedor' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ error: 'RefundNotSupported' });
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(false);
  });

  it('404s an order that does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/does-not-exist/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'pedido inexistente para testar 404' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-admin caller', async () => {
    const { user } = await createUser({ email: 'notadmin@jdm.test', verified: true });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { reason: 'nao deveria passar daqui' },
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(false);
  });

  it('rejects an organizer caller (refund is admin-only)', async () => {
    const { user: organizer } = await createUser({
      email: 'organizer-refund@jdm.test',
      role: 'organizer',
      verified: true,
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
      payload: { reason: 'organizer nao deveria reembolsar' },
    });
    expect(res.statusCode).toBe(403);
  });
});
