import { prisma } from '@ccc/db';
import { CELEBRATION_WINDOW_DAYS } from '@ccc/shared/badges';
import {
  BADGE_AWARDED_GROUP_NOTIFICATION_TITLE,
  BADGE_AWARDED_NOTIFICATION_KIND,
  BADGE_AWARDED_NOTIFICATION_TITLE,
  badgeAwardedGroupBody,
} from '@ccc/shared/badges-copy';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import { readGamificationEnabled } from '../services/garage/killswitch.js';
import type { PushSender } from '../services/push/index.js';
import { deliverGroupedNotifications, suppressGroup } from '../services/push/grouped.js';
import { deliverNotification } from '../services/push/transactional.js';

// Kinds this worker OWNS. CRITICAL: the Notification table is not a
// dedicated outbox — other writers create rows with a null sentAt that must
// NOT be push-delivered here: `broadcast` (delivered via its own
// BroadcastDelivery worker) must never appear in this list. `badge_awarded`
// IS owned by this worker, but is handled through a separate grouped path
// below (killswitch + pushPrefs gates, one push per user per tick) instead of
// the per-row `deliverNotification` loop — see the split right after the
// `findMany` below. A kind-agnostic `sentAt IS NULL` scan would wrongly push
// `broadcast`, so it must stay out of this list.
const DELIVERABLE_KINDS = [
  'box.paid',
  'box.ready',
  'box.shipped',
  'box.delivered',
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
  BADGE_AWARDED_NOTIFICATION_KIND,
] as const;

const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 60_000;

const BADGE_KIND = BADGE_AWARDED_NOTIFICATION_KIND;

const transactionalAllowed = (prefs: unknown): boolean => {
  // Coluna Json com default {"transactional":true,"marketing":false}. Linha
  // antiga pode não ter a chave, e ausência conta como `true`.
  if (typeof prefs !== 'object' || prefs === null) return true;
  const v = (prefs as Record<string, unknown>).transactional;
  return v !== false;
};

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
    select: { id: true, kind: true, userId: true, body: true, createdAt: true },
  });

  const badgeRows = pending.filter((n) => n.kind === BADGE_KIND);
  const others = pending.filter((n) => n.kind !== BADGE_KIND);

  for (const n of others) {
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

  if (badgeRows.length > 0) {
    // Killswitch, uma vez por tick. Sem isto o admin desliga a gamificação e
    // ainda vê push sair pelos próximos minutos, com o GET devolvendo
    // enabled:false e o app obrigado a não mostrar nada. As linhas ficam
    // pendentes de propósito: se religar, voltam a ser entregáveis.
    const enabled = await readGamificationEnabled();
    if (enabled) {
      // Piso de idade. `GET /me/garage/badges/celebrations` carimba a
      // GarageBadge sozinho depois de CELEBRATION_WINDOW_DAYS, então uma
      // linha de Notification mais velha que a janela representa uma
      // conquista que o app já não vai celebrar — entregar o push levaria a
      // uma fila vazia. Isto também é o que fecha a porta dos fundos do
      // killswitch: religar gamificação meses depois não deve reviver push
      // de linhas antigas que ficaram paradas de propósito.
      const celebrationCutoff = new Date(
        now.getTime() - CELEBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const staleBadgeRows = badgeRows.filter((r) => r.createdAt < celebrationCutoff);
      const deliverableBadgeRows = badgeRows.filter((r) => r.createdAt >= celebrationCutoff);

      if (staleBadgeRows.length > 0) {
        try {
          await suppressGroup(
            staleBadgeRows.map((r) => r.id),
            now,
          );
        } catch (err) {
          deps.log?.error({ err }, '[notification-delivery] stale badge suppress failed');
        }
      }

      const userIds = [...new Set(deliverableBadgeRows.map((r) => r.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, pushPrefs: true },
      });
      const allowed = new Set(
        users.filter((u) => transactionalAllowed(u.pushPrefs)).map((u) => u.id),
      );

      for (const userId of userIds) {
        const group = deliverableBadgeRows.filter((r) => r.userId === userId);
        const ids = group.map((r) => r.id);
        if (!allowed.has(userId)) {
          // Preferência governa o push, não o inbox: a linha da central fica,
          // e é carimbada para não voltar em todo tick.
          try {
            await suppressGroup(ids, now);
          } catch (err) {
            deps.log?.error({ err, userId }, '[notification-delivery] badge group failed');
          }
          continue;
        }
        const single = group.length === 1;
        try {
          await deliverGroupedNotifications(
            {
              userId,
              notificationIds: ids,
              title: single
                ? BADGE_AWARDED_NOTIFICATION_TITLE
                : BADGE_AWARDED_GROUP_NOTIFICATION_TITLE,
              body: single ? group[0]!.body : badgeAwardedGroupBody(group.length),
              data: { kind: BADGE_KIND, route: 'notifications', count: group.length },
            },
            { sender: deps.sender, now },
          );
        } catch (err) {
          deps.log?.error({ err, userId }, '[notification-delivery] badge group failed');
        }
      }
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
