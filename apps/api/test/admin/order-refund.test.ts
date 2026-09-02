import { prisma } from '@ccc/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /admin/orders/:id/refund', () => {
  let ctx: Awaited<ReturnType<typeof makeAppWithFakeStripe>>;
  let adminAuth: string;
  let adminId: string;
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
    adminId = admin.id;

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

  it('422s an order with no providerRef', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { providerRef: null } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'pedido sem providerRef para testar 422' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'OrderNotRefundable' });
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(false);
  });

  // Fix round 1, IMPORTANT. A partial refund really moves money at Stripe,
  // but charge.refunded leaves Order.status untouched below the full amount,
  // so the 202 this route would otherwise return is indistinguishable from
  // "done". Refuse instead of returning a misleading 202.
  it('422s a partial amount and does not call Stripe', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'tentativa de reembolso parcial', amountCents: 6_000 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'PartialRefundNotSupported' });
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(false);
  });

  it('accepts an explicit amountCents equal to the full order total', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'valor cheio explicito', amountCents: 12_000 },
    });
    expect(res.statusCode).toBe(202);
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(true);
  });

  // Fix round 1, CRITICAL. No idempotency key, no lock and no local status
  // flip meant two concurrent requests for the same order passed identical
  // preconditions. The advisory lock plus the AdminAudit dedup check must
  // let exactly one of the two reach Stripe.
  it('serializes two concurrent requests into exactly one Stripe call', async () => {
    const [res1, res2] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/admin/orders/${orderId}/refund`,
        headers: { authorization: adminAuth },
        payload: { reason: 'primeira chamada concorrente' },
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/admin/orders/${orderId}/refund`,
        headers: { authorization: adminAuth },
        payload: { reason: 'segunda chamada concorrente' },
      }),
    ]);

    const refundCalls = ctx.stripe.calls.filter((c) => c.kind === 'refund');
    expect(refundCalls).toHaveLength(1);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([202, 409]);
  });

  // Re-review, Minor 1. A claim stuck at 'pending' and a claim already
  // 'accepted' are both 409, but they are NOT the same operator situation.
  // 'accepted' means wait for the webhook. 'pending' means no outcome was ever
  // recorded, this route will never resend for this order, and waiting is
  // futile — only the Stripe dashboard resolves it. Collapsing the two into
  // "aguarde o webhook" strands the operator on an order that is stuck forever.
  it('distinguishes a stuck claim from one Stripe already accepted', async () => {
    await prisma.adminAudit.create({
      data: {
        actorId: adminId,
        action: 'order.refund_requested',
        entityType: 'order',
        entityId: orderId,
        metadata: { reason: 'travou antes de registrar o desfecho', stripeStatus: 'pending' },
      },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'tentativa depois do travamento' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'RefundStuck' });
    expect(res.json().message).toContain('dashboard');
    // Blocked means blocked: nothing may reach Stripe.
    expect(ctx.stripe.calls.some((c) => c.kind === 'refund')).toBe(false);
  });

  // Stripe rejecting the call (network error, already-refunded PI, etc.)
  // must surface as a clean status the admin screen can render, not a 500.
  it('maps a Stripe refund failure to a clean response instead of a 500', async () => {
    ctx.stripe.nextRefundError = new Error('stripe: charge already refunded');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'stripe vai rejeitar esta chamada' },
    });
    ctx.stripe.nextRefundError = null;

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'RefundFailed' });
    // Fix round 2: the claim row now survives the failure, but it must say so
    // — `stripeStatus: 'failed'` is what stops it from reading as "a refund
    // was requested" and what allows a retry.
    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'order.refund_requested', entityId: orderId },
      select: { metadata: true },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { stripeStatus?: string })?.stripeStatus).toBe('failed');
  });

  // Fix round 2, IMPORTANT. A Stripe failure leaves the order refundable: the
  // deterministic idempotency key collapses a retry into the same refund at
  // Stripe for 24h, and past that window `charge.refunded` has already moved
  // Order.status off `paid`, which the precondition above refuses.
  it('allows a retry after Stripe answered with an error', async () => {
    ctx.stripe.nextRefundError = new Error('stripe: transient 500');
    const first = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'primeira tentativa que a stripe rejeita' },
    });
    ctx.stripe.nextRefundError = null;
    expect(first.statusCode).toBe(502);

    const second = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'segunda tentativa depois da falha da stripe' },
    });
    expect(second.statusCode).toBe(202);
    expect(ctx.stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(1);
  });

  // Fix round 2, IMPORTANT — the regression. The Stripe call used to run
  // INSIDE the claim transaction. Prisma's default interaction timeout is 5s
  // and packages/db sets no transactionOptions, so a refund Stripe ACCEPTED
  // but answered slowly aborted with P2028, rolled the audit row back and
  // answered 502 — which the admin renders as "a Stripe recusou a
  // solicitação". False: the money had already moved, and the operator's
  // documented next step (a manual refund on the dashboard, with no
  // idempotency key) double-refunds. A refund slower than the 5s default must
  // now still succeed.
  it('survives a Stripe call slower than the default 5s transaction timeout', async () => {
    const original = ctx.stripe.refund;
    ctx.stripe.refund = async (...args: Parameters<typeof original>) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      return original(...args);
    };
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/admin/orders/${orderId}/refund`,
        headers: { authorization: adminAuth },
        payload: { reason: 'stripe demora mais que o timeout do prisma' },
      });
      expect(res.statusCode).toBe(202);
    } finally {
      ctx.stripe.refund = original;
    }

    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'order.refund_requested', entityId: orderId },
      select: { metadata: true },
    });
    expect((audit?.metadata as { stripeStatus?: string })?.stripeStatus).toBe('accepted');
  }, 30_000);

  // Proves the claim really committed before the external call: an
  // independent connection can see the audit row WHILE Stripe is still
  // answering. Inside a transaction it would be invisible.
  it('commits the claim before calling Stripe, not inside the same transaction', async () => {
    const original = ctx.stripe.refund;
    let visibleDuringCall = -1;
    ctx.stripe.refund = async (...args: Parameters<typeof original>) => {
      visibleDuringCall = await prisma.adminAudit.count({
        where: { action: 'order.refund_requested', entityId: orderId },
      });
      return original(...args);
    };
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/admin/orders/${orderId}/refund`,
        headers: { authorization: adminAuth },
        payload: { reason: 'claim precisa estar commitado antes da stripe' },
      });
      expect(res.statusCode).toBe(202);
    } finally {
      ctx.stripe.refund = original;
    }
    expect(visibleDuringCall).toBe(1);
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
