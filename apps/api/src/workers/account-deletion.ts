import { prisma } from '@jdm/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { anonymizeUser } from '../services/account-deletion/anonymize.js';
import { runVendorFanout } from '../services/account-deletion/vendor-fanout.js';
import type { StripeClient } from '../services/stripe/index.js';
import type { Uploads } from '../services/uploads/index.js';

export type DeletionWorkerDeps = {
  graceDays: number;
  uploads: Uploads;
  stripe: StripeClient;
  env: Env;
  batchSize?: number;
  log?: FastifyBaseLogger;
};

export const runDeletionWorkerTick = async (deps: DeletionWorkerDeps): Promise<void> => {
  const cutoff = new Date(Date.now() - deps.graceDays * 24 * 3600_000);
  const batchSize = deps.batchSize ?? 5;

  const candidates = await prisma.user.findMany({
    where: {
      status: 'deleted',
      deletedAt: { lte: cutoff },
    },
    select: { id: true },
    take: batchSize,
  });

  for (const { id } of candidates) {
    try {
      const fanoutSteps = await runVendorFanout(id, deps.stripe, deps.env);
      await anonymizeUser(id, deps.uploads, fanoutSteps);
    } catch (err) {
      deps.log?.error({ err, userId: id }, '[deletion-worker] failed to anonymize user');
      const errorMsg = err instanceof Error ? err.message : String(err);
      const existing = await prisma.deletionLog.findUnique({ where: { userId: id } });
      if (existing) {
        await prisma.deletionLog.update({
          where: { userId: id },
          data: { error: errorMsg },
        });
      } else {
        deps.log?.warn(
          { userId: id },
          '[deletion-worker] no DeletionLog row found for failed user',
        );
      }
    }
  }
};

export const startDeletionWorker = (deps: DeletionWorkerDeps) => {
  const task = cron.schedule('0 3 * * *', async () => {
    try {
      await runDeletionWorkerTick(deps);
    } catch (err) {
      deps.log?.error({ err }, '[deletion-worker] tick error');
    }
  });

  return { stop: () => task.stop() };
};
