import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { runPixReconcileTick } from '../../src/workers/pix-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();
const NOW = new Date('2026-09-05T12:00:00.000Z');
const OLD = new Date('2026-09-05T11:00:00.000Z');

describe('runPixReconcileTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const makePendingPixOrder = async (providerRef: string | null, createdAt = OLD) => {
    const { user } = await createUser({ email: `pix-${providerRef ?? 'none'}@jdm.test` });
    return prisma.order.create({
      data: {
        userId: user.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        status: 'pending',
        providerRef,
        createdAt,
        kind: 'product',
      },
      select: { id: true },
    });
  };

  // The whole reason the worker exists: a lost transparent.completed leaves the
  // Pix paid and the order pending, and the lazy expiry sweep would EXPIRE it
  // rather than settle it. Money in, nothing out, stock back on the shelf.
  it('settles a pending order whose Pix the provider reports as PAID', async () => {
    const order = await makePendingPixOrder('pix_char_paid');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_paid', status: 'PAID', paidAt: NOW.toISOString() };

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

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

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('pending');
  });

  it('skips orders with no providerRef instead of calling the provider', async () => {
    await makePendingPixOrder(null);
    const abacatepay = buildFakeAbacatePay();

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(0);
  });

  it('ignores orders created inside the grace window', async () => {
    await makePendingPixOrder('pix_char_fresh', new Date(NOW.getTime() - 60_000));
    const abacatepay = buildFakeAbacatePay();

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

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

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

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

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });
    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('paid');
  });

  // Decision: EXPIRED/FAILED at the provider is left alone by this worker.
  // Settling never applies here (nothing was paid); expiring/refunding is
  // owned by order-expiry.ts and the webhook's failure-event branch, both of
  // which have their own invariants (stock release, PI cancellation). This
  // worker only ever moves an order pending -> paid, never pending -> expired
  // or pending -> failed, so it cannot race either of those paths.
  it('leaves an order the provider reports EXPIRED alone', async () => {
    const order = await makePendingPixOrder('pix_char_expired');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_expired', status: 'EXPIRED', paidAt: null };

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('pending');
  });
});
