import { prisma } from '@jdm/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { PushSender } from '../services/push/index.js';
import { sendTransactionalPush } from '../services/push/transactional.js';

type ReminderKind = 'event.reminder_24h' | 'event.reminder_1h';

const WINDOWS: Array<{ kind: ReminderKind; lowerMs: number; upperMs: number; copy: string }> = [
  {
    kind: 'event.reminder_24h',
    lowerMs: 23 * 60 * 60 * 1000 + 59 * 60 * 1000,
    upperMs: 24 * 60 * 60 * 1000,
    copy: 'Seu evento começa em 24 horas.',
  },
  {
    kind: 'event.reminder_1h',
    lowerMs: 59 * 60 * 1000,
    upperMs: 60 * 60 * 1000,
    copy: 'Seu evento começa em 1 hora.',
  },
];

export type RunTickDeps = { sender: PushSender; now?: Date; log?: FastifyBaseLogger };

export const runEventRemindersTick = async (deps: RunTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();

  for (const w of WINDOWS) {
    const lower = new Date(now.getTime() + w.lowerMs);
    const upper = new Date(now.getTime() + w.upperMs);

    const events = await prisma.event.findMany({
      where: {
        status: 'published',
        startsAt: { gte: lower, lte: upper },
      },
      select: { id: true, title: true },
    });

    for (const event of events) {
      const tickets = await prisma.ticket.findMany({
        where: { eventId: event.id, status: 'valid' },
        select: { userId: true },
        distinct: ['userId'],
      });

      let sent = 0;
      let deduped = 0;
      let invalidated = 0;
      for (const t of tickets) {
        const result = await sendTransactionalPush(
          {
            userId: t.userId,
            kind: w.kind,
            dedupeKey: event.id,
            title: event.title,
            body: w.copy,
            data: { eventId: event.id, kind: w.kind },
          },
          { sender: deps.sender },
        );
        if (result.deduped) deduped += 1;
        else sent += result.sent;
        invalidated += result.invalidatedTokens;
      }
      deps.log?.info(
        {
          eventId: event.id,
          kind: w.kind,
          totalUsers: tickets.length,
          sent,
          deduped,
          invalidated,
        },
        'event reminders: dispatched',
      );
    }
  }
};

export const startEventRemindersWorker = (deps: {
  sender: PushSender;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('* * * * *', () => {
    void runEventRemindersTick({ sender: deps.sender, log: deps.log }).catch((err: unknown) => {
      deps.log.error({ err }, 'event reminders tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
