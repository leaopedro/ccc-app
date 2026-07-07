import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import { runBroadcastDispatchTick } from '../services/broadcasts/dispatch.js';
import type { PushSender } from '../services/push/index.js';

export type BroadcastWorkerDeps = {
  sender: PushSender;
  batchSize?: number;
  log?: FastifyBaseLogger;
};

export const startBroadcastWorker = (deps: BroadcastWorkerDeps) => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runBroadcastDispatchTick({
        sender: deps.sender,
        ...(deps.batchSize !== undefined && { batchSize: deps.batchSize }),
        ...(deps.log !== undefined && { log: deps.log }),
      });
    } catch (err) {
      deps.log?.error({ err }, '[broadcasts-worker] tick error');
    }
  });

  return {
    stop: () => task.stop(),
  };
};
