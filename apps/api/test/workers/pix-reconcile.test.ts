import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { runPixReconcileTick } from '../../src/workers/pix-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();
const NOW = new Date('2026-09-05T12:00:00.000Z');
const OLD = new Date('2026-09-05T11:00:00.000Z');

describe('runPixReconcileTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const makePendingPixOrder = async (
    providerRef: string | null,
    createdAt = OLD,
    status: 'pending' | 'expired' = 'pending',
  ) => {
    const { user } = await createUser({ email: `pix-${providerRef ?? 'none'}@jdm.test` });
    return prisma.order.create({
      data: {
        userId: user.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        status,
        providerRef,
        createdAt,
        kind: 'product',
      },
      select: { id: true },
    });
  };

  // Ticket-kind fixture (event + tier) so settlePaidOrder's single-order
  // branch actually returns kind 'ticket' — the only shape the webhook (and
  // now this worker) sends a `ticket.confirmed` push for.
  const makePendingTicketPixOrder = async (providerRef: string, createdAt = OLD) => {
    const { user } = await createUser({ email: `pix-ticket-${providerRef}@jdm.test` });
    const event = await prisma.event.create({
      data: {
        slug: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: 'JDM Spring Meetup',
        description: 'd',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600_000),
        type: 'meeting',
        status: 'published',
        capacity: 100,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 5000, quantityTotal: 100 },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        status: 'pending',
        providerRef,
        createdAt,
      },
      select: { id: true },
    });
    return { user, event, order };
  };

  // The whole reason the worker exists: a lost transparent.completed leaves the
  // Pix paid and the order pending, and the lazy expiry sweep would EXPIRE it
  // rather than settle it. Money in, nothing out, stock back on the shelf.
  it('settles a pending order whose Pix the provider reports as PAID', async () => {
    const order = await makePendingPixOrder('pix_char_paid');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_paid', status: 'PAID', paidAt: NOW.toISOString() };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true },
    });
    expect(row.status).toBe('paid');
    expect(row.paidAt).not.toBeNull();
  });

  it('leaves a still-pending Pix alone', async () => {
    const order = await makePendingPixOrder('pix_char_pending');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_pending', status: 'PENDING', paidAt: null };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('pending');
  });

  it('skips orders with no providerRef instead of calling the provider', async () => {
    await makePendingPixOrder(null);
    const abacatepay = buildFakeAbacatePay();
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(0);
  });

  it('ignores orders created inside the grace window', async () => {
    await makePendingPixOrder('pix_char_fresh', new Date(NOW.getTime() - 60_000));
    const abacatepay = buildFakeAbacatePay();
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(0);
  });

  // One bad row must never stop the sweep. Same contract as billing-reconcile.
  it('continues past a provider error on one row', async () => {
    const bad = await makePendingPixOrder('pix_char_boom');
    const good = await makePendingPixOrder('pix_char_ok');

    const abacatepay = buildFakeAbacatePay();
    const original = abacatepay.getPixBilling;
    abacatepay.getPixBilling = (id: string) => {
      if (id === 'pix_char_boom') return Promise.reject(new Error('upstream 500'));
      return original(id);
    };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    const rows = await prisma.order.findMany({
      where: { id: { in: [bad.id, good.id] } },
      select: { id: true, status: true },
    });
    expect(rows.find((r) => r.id === bad.id)?.status).toBe('pending');
    expect(rows.find((r) => r.id === good.id)?.status).toBe('paid');
  });

  it('is idempotent — a second tick does not re-settle', async () => {
    const order = await makePendingPixOrder('pix_char_twice');
    const abacatepay = buildFakeAbacatePay();
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });
    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('paid');
  });

  // Decision: EXPIRED/FAILED reported by the PROVIDER for a still-pending
  // order is left alone. Settling never applies (nothing was paid);
  // expiring/refunding is owned by order-expiry.ts and the webhook's
  // failure-event branch, both of which have their own invariants (stock
  // release, PI cancellation). This worker only ever moves an order
  // pending -> paid, never pending -> expired or pending -> failed.
  it('leaves an order the provider reports EXPIRED alone', async () => {
    const order = await makePendingPixOrder('pix_char_expired');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_expired', status: 'EXPIRED', paidAt: null };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('pending');
  });

  // Fix round 1 (2026-09-01): order-expiry.ts flips pending -> expired at
  // t=15min with no provider check, and the sweep used to only ever select
  // `status: 'pending'` — so a webhook loss + expiry race made the order
  // permanently invisible to reconciliation. The provider is the source of
  // truth for whether money moved; local status must not gate whether we
  // look. But settling here would oversell (order-expiry already released
  // the stock), and there is no refund API — so the only honest move is a
  // loud, deduplicated alert. The order is NOT settled and stays `expired`.
  it('alerts (does not settle) an order the provider reports PAID after local expiry', async () => {
    const order = await makePendingPixOrder('pix_char_expired_but_paid', OLD, 'expired');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = {
      id: 'pix_char_expired_but_paid',
      status: 'PAID',
      paidAt: NOW.toISOString(),
    };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true },
    });
    expect(row.status).toBe('expired');
    expect(row.paidAt).toBeNull();

    const flag = await prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: 'abacatepay',
          eventId: `pix-reconcile:expired-but-paid:${order.id}`,
        },
      },
    });
    expect(flag).not.toBeNull();
  });

  it('does not re-fetch or re-alert an already-flagged expired-but-paid order on a later tick', async () => {
    const order = await makePendingPixOrder('pix_char_expired_dedupe', OLD, 'expired');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = {
      id: 'pix_char_expired_dedupe',
      status: 'PAID',
      paidAt: NOW.toISOString(),
    };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });
    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(1);

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });
    // Second tick must not call the provider again for this row.
    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(1);

    const flagCount = await prisma.paymentWebhookEvent.count({
      where: { provider: 'abacatepay', eventId: `pix-reconcile:expired-but-paid:${order.id}` },
    });
    expect(flagCount).toBe(1);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('expired');
  });

  // Important fix: a recovered customer must be told, same push the webhook
  // sends (abacatepay-webhook.ts single-order branch).
  it('sends the ticket.confirmed push on a recovered settlement', async () => {
    const { user, event } = await makePendingTicketPixOrder('pix_char_push');
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[pix1111111]', platform: 'ios' },
    });
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_push', status: 'PAID', paidAt: NOW.toISOString() };
    const push = new DevPushSender();

    await runPixReconcileTick({ abacatepay, push, env, alertDepth: 200, now: NOW });

    expect(push.captured).toHaveLength(1);
    expect(push.captured[0]?.title).toBe('Pagamento confirmado');
    expect(push.captured[0]?.body).toContain(event.title);

    const notification = await prisma.notification.findFirst({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notification).not.toBeNull();
  });
});
