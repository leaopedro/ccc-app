import { prisma } from '@jdm/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { processExportJob } from '../services/data-export.js';

export type DataExportWorkerDeps = {
  env: Env;
  log?: FastifyBaseLogger;
};

const tick = async (deps: DataExportWorkerDeps) => {
  const jobs = await prisma.dataExportJob.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  for (const job of jobs) {
    try {
      const outcome = await processExportJob(job.id, deps.env);
      if (outcome === 'completed') {
        deps.log?.info({ jobId: job.id, userId: job.userId }, '[data-export-worker] job completed');
      } else if (outcome === 'failed') {
        deps.log?.error({ jobId: job.id, userId: job.userId }, '[data-export-worker] job failed');
      }
    } catch (err) {
      deps.log?.error({ err, jobId: job.id }, '[data-export-worker] unexpected error');
    }
  }
};

export const startDataExportWorker = (deps: DataExportWorkerDeps) => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await tick(deps);
    } catch (err) {
      deps.log?.error({ err }, '[data-export-worker] tick error');
    }
  });

  return { stop: () => task.stop() };
};
