import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

describe('Notification delivery-state columns', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('defaults attemptCount to 0 and allows null lastAttemptAt/failureCode', async () => {
    const { user } = await createUser({ verified: true });
    const n = await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'box.ready',
        dedupeKey: 'box_1',
        title: 'x',
        body: 'y',
        data: {},
      },
    });
    expect(n.attemptCount).toBe(0);
    expect(n.lastAttemptAt).toBeNull();
    expect(n.failureCode).toBeNull();
    expect(n.sentAt).toBeNull();
  });
});
