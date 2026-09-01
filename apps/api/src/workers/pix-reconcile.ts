/**
 * Pix reconciliation sweep.
 *
 * Mirror of workers/billing-reconcile.ts, but for AbacatePay one-off charges
 * instead of Stripe subscriptions. Nothing swept them before this worker
 * existed.
 *
 * The failure it closes: a lost `transparent.completed` leaves the Pix paid at
 * the provider and the Order `pending` locally. The only settlement path is
 * routes/abacatepay-webhook.ts, and the expiry sweep is lazy — triggered by
 * another checkout on the same tier/variant, or by GET /orders/:id — and it
 * EXPIRES the order rather than settling it. So the customer pays, the stock
 * goes back on the shelf, no ticket is issued and no refund happens.
 *
 * Per row:
 *   1. Ask AbacatePay for the authoritative status (`getPixBilling`).
 *   2. If PAID, run the same `settlePaidOrder` the webhook runs.
 *   3. Anything else (PENDING, EXPIRED, FAILED, ...): leave it alone. The
 *      worker never expires and never refunds — both are other code's job
 *      (order-expiry.ts and the webhook's failure-event branch), and
 *      guessing here loses money in the other direction. Expiring a Pix that
 *      the provider still considers open would release stock a late payment
 *      could still land on top of; refunding is a human decision this
 *      worker has no context to make.
 *
 * A row error never crashes the tick.
 */
import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import type { AbacatePayClient } from '../services/abacatepay/index.js';
import { settlePaidOrder } from '../services/orders/settle.js';

export type PixReconcileTickDeps = {
  abacatepay: AbacatePayClient;
  env: Env;
  alertDepth: number;
  now?: Date;
  log?: FastifyBaseLogger;
};

const QUERY_LIMIT = 200;

/**
 * Grace window. A Pix created seconds ago is not drift, it is a customer who
 * has not paid yet. Sweeping it would burn a provider call per tick per open
 * checkout for no reason.
 */
const GRACE_MS = 10 * 60 * 1000;

export const runPixReconcileTick = async (deps: PixReconcileTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const log = deps.log;

  const staleRows = await prisma.order.findMany({
    where: {
      provider: 'abacatepay',
      status: 'pending',
      providerRef: { not: null },
      createdAt: { lt: new Date(now.getTime() - GRACE_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: QUERY_LIMIT,
    select: { id: true, providerRef: true, cartId: true },
  });

  if (staleRows.length >= deps.alertDepth) {
    log?.warn(
      {
        kind: 'pix-reconcile.queue_depth_alert',
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
      },
      'pix-reconcile: stale pending Pix queue depth at or above alert threshold',
    );
  }

  for (const row of staleRows) {
    const providerRef = row.providerRef;
    if (!providerRef) continue;

    try {
      const upstream = await deps.abacatepay.getPixBilling(providerRef);
      if (upstream.status !== 'PAID') continue;

      await settlePaidOrder(
        row.id,
        providerRef,
        deps.env,
        row.cartId ? { cartId: row.cartId } : undefined,
      );

      log?.warn(
        {
          kind: 'pix-reconcile.recovered',
          orderId: row.id,
          providerRef,
        },
        'pix-reconcile: settled a Pix the webhook never delivered',
      );
    } catch (err) {
      log?.error(
        { err, orderId: row.id, providerRef },
        'pix-reconcile: failed to reconcile row, continuing to next',
      );
      // Non-fatal: continue processing remaining rows.
    }
  }
};

export const startPixReconcileWorker = (deps: {
  abacatepay: AbacatePayClient;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('*/15 * * * *', () => {
    void runPixReconcileTick({
      abacatepay: deps.abacatepay,
      env: deps.env,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'pix-reconcile tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
