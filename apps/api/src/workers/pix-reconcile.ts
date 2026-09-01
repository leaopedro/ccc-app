/**
 * Pix reconciliation sweep.
 *
 * Mirror of workers/billing-reconcile.ts, but for AbacatePay one-off charges
 * instead of Stripe subscriptions. Nothing swept them before this worker
 * existed.
 *
 * The failure it closes: a lost `transparent.completed` leaves the Pix paid at
 * the provider and the Order `pending` locally. The only settlement path is
 * routes/abacatepay-webhook.ts, and the expiry sweep (order-expiry.ts) runs
 * EVERY MINUTE with no provider check and flips `pending -> expired` the
 * moment `Order.expiresAt` (ORDER_EXPIRY_MS = 15min after creation) passes.
 *
 * Cadence (review fix round 1, 2026-09-01): a pending Pix order is only
 * visible to this sweep once it clears GRACE_MS, and becomes permanently
 * invisible (query only selects `pending`) the instant order-expiry flips it
 * to `expired`. GRACE_MS = ORDER_EXPIRY_MS / 5 = 3min, so the pending window
 * is [3min, 15min) after creation — 12 minutes wide. Ticking every 1 minute
 * (matching order-expiry's own cadence) gives >= 12 real chances to catch a
 * given order inside that window, instead of the old 15-minute cron racing a
 * 15-minute TTL with often zero aligned opportunities.
 *
 * Per row:
 *   1. Ask AbacatePay for the authoritative status (`getPixBilling`).
 *   2. Not PAID (PENDING, EXPIRED, FAILED, ...): leave it alone. The worker
 *      never itself expires or fails an order — that is order-expiry.ts's
 *      and the webhook's failure-event branch's job.
 *   3. PAID + order still `pending` locally: settle through the exact same
 *      `settlePaidOrder` the webhook calls, then send the same
 *      `ticket.confirmed` push the webhook sends — a customer recovered
 *      hours later must still find out their order is ready.
 *   4. PAID + order already `expired` locally: order-expiry already RELEASED
 *      THE STOCK for this row. Settling now would oversell (same class of
 *      bug flagged in the Stripe cart path). Refunding is not possible —
 *      AbacatePayClient exposes no refund call. The only honest move is a
 *      loud, deduplicated Sentry alert for manual handling; the order is
 *      left `expired` and untouched.
 *
 * A row error never crashes the tick.
 */
import { prisma } from '@ccc/db';
import type { OrderStatus } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import type { AbacatePayClient } from '../services/abacatepay/index.js';
import { ORDER_EXPIRY_MS } from '../services/orders/expire.js';
import { settlePaidOrder, type SettledOrderResult } from '../services/orders/settle.js';
import { sendTransactionalPush } from '../services/push/transactional.js';
import type { PushSender } from '../services/push/types.js';

export type PixReconcileTickDeps = {
  abacatepay: AbacatePayClient;
  push: PushSender;
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
 *
 * Derived from ORDER_EXPIRY_MS (see cadence note above) rather than a bare
 * constant, so the two stay proportional if the order TTL ever changes.
 */
const GRACE_MS = ORDER_EXPIRY_MS / 5;

/**
 * Upper bound on how far back the sweep looks (fix round 2, CRITICAL).
 *
 * Without it this worker starved itself. The window selects
 * `status in ('pending','expired')` and NOTHING ever moves a row out of
 * `expired` — order-expiry.ts only writes `pending -> expired`, and this
 * worker deliberately refuses to settle an expired row. So every abandoned
 * Pix checkout ever made stayed permanent sweep input. Ordered oldest-first
 * and capped at QUERY_LIMIT, the window filled with ancient `expired` rows
 * and stopped reaching any `pending` row at all — silently turning off the
 * exact lost-webhook recovery the worker exists for. The per-row cost was the
 * same shape: one getPixBilling HTTP call per minute, forever, per abandoned
 * checkout (the `alreadyFlagged` skip only covers rows already alerted as
 * PAID, which is the rare case, not the normal one).
 *
 * Why 48h:
 *   - ORDER_EXPIRY_MS is 15 minutes, so 48h is 192x the order TTL. A Pix that
 *     is going to be paid is paid inside its own BR Code validity, not two
 *     days later.
 *   - abacatepay-webhook.ts's REPLAY_WINDOW_MS is 24h: an event whose payload
 *     timestamp is older than that is REJECTED. Past 24h no webhook redelivery
 *     can settle the row any more, so 48h already gives a full extra day of
 *     sweep coverage beyond the point where the provider could still fix it
 *     itself.
 *   - Anything older than that is not drift a per-minute cron should keep
 *     retrying; it is an incident for a human, and the expired-but-paid alert
 *     below is how a human learns about it.
 */
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

type StaleRow = {
  id: string;
  providerRef: string | null;
  cartId: string | null;
  status: OrderStatus;
  amountCents: number;
};

/**
 * Deterministic id for the "this order settled PAID after local expiry"
 * alert, stored in PaymentWebhookEvent (provider, eventId unique) exactly
 * like the webhook's own `markProcessed` dedup — same table, same idiom,
 * no schema change. Guarantees the loud alert fires ONCE per order, not
 * once per tick forever while a human resolves it manually.
 */
const expiredButPaidAlertEventId = (orderId: string): string =>
  `pix-reconcile:expired-but-paid:${orderId}`;

const flagExpiredButPaid = async (
  row: StaleRow,
  providerRef: string,
  log?: FastifyBaseLogger,
): Promise<void> => {
  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'abacatepay',
        eventId: expiredButPaidAlertEventId(row.id),
        payload: {
          orderId: row.id,
          providerRef,
          amountCents: row.amountCents,
          reason: 'expired-but-paid',
        },
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) return; // already alerted, do not re-fire
    throw err;
  }

  Sentry.withScope((scope) => {
    scope.setTag('kind', 'pix-manual-refund-needed');
    scope.setTag('provider', 'abacatepay');
    scope.setTag('reason', 'expired-but-paid');
    scope.setExtras({ orderId: row.id, providerRef, amountCents: row.amountCents });
    Sentry.captureMessage('abacatepay: manual refund needed (expired-but-paid)', 'error');
  });
  log?.error(
    {
      kind: 'pix-reconcile.expired_but_paid',
      orderId: row.id,
      providerRef,
      amountCents: row.amountCents,
    },
    'pix-reconcile: order expired locally but provider reports PAID — stock already released, cannot auto-settle, manual refund needed',
  );
};

/** Same `ticket.confirmed` push the webhook's single-order branch sends. */
const notifyRecoveredOrder = async (
  orderId: string,
  settled: SettledOrderResult,
  push: PushSender,
  log?: FastifyBaseLogger,
): Promise<void> => {
  if (settled.kind !== 'ticket' && settled.kind !== 'extras_only') return;
  try {
    await sendTransactionalPush(
      {
        userId: settled.issued.userId,
        kind: 'ticket.confirmed',
        dedupeKey: orderId,
        title: 'Pagamento confirmado',
        body: `Seu ingresso para ${settled.issued.eventTitle} está pronto.`,
        data: {
          orderId,
          ticketId: settled.issued.ticketId,
          eventId: settled.issued.eventId,
        },
      },
      { sender: push },
    );
  } catch (pushErr) {
    log?.warn(
      { err: pushErr, orderId },
      'pix-reconcile: ticket-confirmed push failed after recovered settlement',
    );
    Sentry.withScope((scope) => {
      scope.setTag('kind', 'push-send-failure');
      scope.setTag('push_kind', 'ticket.confirmed');
      scope.setLevel('warning');
      scope.setExtras({ orderId });
      Sentry.captureException(pushErr);
    });
  }
};

export const runPixReconcileTick = async (deps: PixReconcileTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const log = deps.log;

  // Sweep BOTH pending and already-locally-expired rows: the provider is the
  // source of truth for whether money moved, and local status must not
  // decide whether we even look (that is exactly how a lost webhook +
  // order-expiry combine to hide a paid order forever).
  // Bounded on BOTH sides. The lower bound (LOOKBACK_MS) is the fix for the
  // self-starvation described on that constant; the upper bound (GRACE_MS) is
  // the "customer has not paid yet" guard.
  const staleRows: StaleRow[] = await prisma.order.findMany({
    where: {
      provider: 'abacatepay',
      status: { in: ['pending', 'expired'] },
      providerRef: { not: null },
      createdAt: {
        gte: new Date(now.getTime() - LOOKBACK_MS),
        lt: new Date(now.getTime() - GRACE_MS),
      },
    },
    orderBy: { createdAt: 'asc' },
    take: QUERY_LIMIT,
    select: { id: true, providerRef: true, cartId: true, status: true, amountCents: true },
  });

  // Saturation alarm. `alertDepth` MUST stay strictly below QUERY_LIMIT
  // (env.ts defaults it to 150 against a limit of 200) — an alarm that can
  // only fire at exactly the limit fires when the sweep is already dropping
  // rows, which is too late to be a warning. Sentry, not just log.warn:
  // silently sweeping a truncated window is a silent-failure condition, and
  // the log line alone has no alerting attached to it.
  if (staleRows.length >= deps.alertDepth) {
    const saturated = staleRows.length >= QUERY_LIMIT;
    log?.warn(
      {
        kind: 'pix-reconcile.queue_depth_alert',
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
        queryLimit: QUERY_LIMIT,
        saturated,
      },
      'pix-reconcile: stale pending Pix queue depth at or above alert threshold',
    );
    Sentry.withScope((scope) => {
      scope.setTag('kind', 'pix-reconcile-queue-depth');
      scope.setTag('provider', 'abacatepay');
      scope.setLevel(saturated ? 'error' : 'warning');
      scope.setExtras({
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
        queryLimit: QUERY_LIMIT,
      });
      Sentry.captureMessage(
        saturated
          ? 'pix-reconcile: sweep window saturated, rows are being dropped'
          : 'pix-reconcile: sweep queue depth above alert threshold',
        saturated ? 'error' : 'warning',
      );
    });
  }

  // Batch-check which already-expired rows were already alerted, so a
  // manual-refund incident that takes days to resolve does not cost a fresh
  // provider call every single minute in the meantime.
  const expiredIds = staleRows.filter((r) => r.status === 'expired').map((r) => r.id);
  const alreadyFlagged =
    expiredIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await prisma.paymentWebhookEvent.findMany({
              where: {
                provider: 'abacatepay',
                eventId: { in: expiredIds.map(expiredButPaidAlertEventId) },
              },
              select: { eventId: true },
            })
          ).map((r) => r.eventId),
        );

  for (const row of staleRows) {
    const providerRef = row.providerRef;
    if (!providerRef) continue;
    if (row.status === 'expired' && alreadyFlagged.has(expiredButPaidAlertEventId(row.id))) {
      continue;
    }

    try {
      const upstream = await deps.abacatepay.getPixBilling(providerRef);
      if (upstream.status !== 'PAID') continue;

      if (row.status === 'expired') {
        await flagExpiredButPaid(row, providerRef, log);
        continue;
      }

      const settled = await settlePaidOrder(
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

      await notifyRecoveredOrder(row.id, settled, deps.push, log);
    } catch (err) {
      Sentry.captureException(err, {
        extra: { orderId: row.id, providerRef, worker: 'pix-reconcile' },
      });
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
  push: PushSender;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  // Every minute, same cadence as order-expiry.ts. See the cadence note atop
  // this file for the arithmetic: at GRACE_MS = 3min and ORDER_EXPIRY_MS =
  // 15min, a 1-minute tick gets >= 12 chances to catch a pending order before
  // it becomes locally `expired`.
  const task = cron.schedule('* * * * *', () => {
    void runPixReconcileTick({
      abacatepay: deps.abacatepay,
      push: deps.push,
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
