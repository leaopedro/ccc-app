import { prisma } from '@jdm/db';

import type { Uploads } from './types.js';

const MS_PER_DAY = 24 * 3600_000;

let _uploads: Uploads | null = null;
let _workerEnabled = false;

export const configureDeletionQueue = (opts: {
  uploads: Uploads;
  workerEnabled: boolean;
}): void => {
  _uploads = opts.uploads;
  _workerEnabled = opts.workerEnabled;
};

export const queueObjectDeletion = async (input: {
  objectKey: string;
  reason?: string;
  now?: Date;
  retentionDays?: number;
}): Promise<void> => {
  const now = input.now ?? new Date();
  const retentionDays = input.retentionDays ?? 30;
  const deleteAfter = new Date(now.getTime() + retentionDays * MS_PER_DAY);

  await prisma.uploadDeletionQueue.upsert({
    where: { objectKey: input.objectKey },
    update: {
      deleteAfter,
      reason: input.reason ?? null,
    },
    create: {
      objectKey: input.objectKey,
      reason: input.reason ?? null,
      deleteAfter,
    },
  });

  if (!_workerEnabled && _uploads) {
    try {
      await _uploads.deleteObject(input.objectKey);
    } catch {
      // best-effort: queue row stays for manual sweep or future worker enable
    }
  }
};
