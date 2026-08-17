import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { PushSender } from '../services/push/index.js';
import { deliverNotification } from '../services/push/transactional.js';

// Kinds this worker OWNS. CRITICAL: the Notification table is not a
// dedicated outbox — other writers create rows with a null sentAt that must
// NOT be push-delivered here: `broadcast` (delivered via its own
// BroadcastDelivery worker) and `badge_awarded` (inbox-only, push
// deliberately deferred, see services/garage/awarder.ts). A kind-agnostic
// `sentAt IS NULL` scan would wrongly push both. Only these kinds flow
// through enqueueNotification/sendTransactionalPush and want worker delivery.
const DELIVERABLE_KINDS = [
  'box.paid',
  'box.ready',
  'box.shipped',
  'box.delivered',
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
] as const;

const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 60_000;

export type DeliveryTickDeps = { sender: PushSender; now?: Date; log?: FastifyBaseLogger };

export const runNotificationDeliveryTick = async (deps: DeliveryTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETRY_INTERVAL_MS);

  const pending = await prisma.notification.findMany({
    where: {
      kind: { in: [...DELIVERABLE_KINDS] },
      sentAt: null,
      attemptCount: { lt: MAX_DELIVERY_ATTEMPTS },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: cutoff } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true },
  });

  for (const n of pending) {
    try {
      const r = await deliverNotification(n.id, { sender: deps.sender, now });
      if (!r.delivered && r.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        // Exhausted retries: the inbox row survives, but the push is abandoned.
        // Surface it — the whole point of this project is "no silent loss".
        deps.log?.error(
          { notificationId: n.id, attemptCount: r.attemptCount },
          '[notification-delivery] giving up after max attempts',
        );
      }
    } catch (err) {
      deps.log?.error({ err, notificationId: n.id }, '[notification-delivery] deliver failed');
    }
  }
};

export const startNotificationDeliveryWorker = (deps: {
  sender: PushSender;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  // Non-overlap guard: node-cron fires every minute and does NOT await the
  // callback, so a tick whose sends run longer than the interval would overlap
  // the next tick. Combined with the retry window that would let the next tick
  // re-claim a row whose send is still in flight and deliver a duplicate. The
  // guard makes ticks strictly sequential in this process. (A send that itself
  // outlives the window remains at-least-once — Expo has no idempotency key —
  // consistent with the "favor delivery over loss" stance.)
  let running = false;
  const task = cron.schedule('* * * * *', () => {
    if (running) {
      deps.log.warn('[notification-delivery] previous tick still running, skipping');
      return;
    }
    running = true;
    void runNotificationDeliveryTick({ sender: deps.sender, log: deps.log })
      .catch((err: unknown) => {
        deps.log.error({ err }, '[notification-delivery] tick error');
      })
      .finally(() => {
        running = false;
      });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
