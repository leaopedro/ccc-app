import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { enqueueBoxNotification } from '../../src/services/box/notifications.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('enqueueBoxNotification', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enqueues a pending box notification with copy, destination and boxId dedupe', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.$transaction((tx) =>
      enqueueBoxNotification(tx, { userId: user.id, boxId: 'box_1', kind: 'box.shipped' }),
    );
    const n = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'box.shipped' },
    });
    expect(n.dedupeKey).toBe('box_1');
    expect(n.title).toBe('Caixa enviada');
    expect(n.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
    expect(n.sentAt).toBeNull();
  });

  it('dedupes a repeated enqueue for the same box and kind', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.$transaction((tx) =>
      enqueueBoxNotification(tx, { userId: user.id, boxId: 'box_1', kind: 'box.ready' }),
    );
    await prisma.$transaction((tx) =>
      enqueueBoxNotification(tx, { userId: user.id, boxId: 'box_1', kind: 'box.ready' }),
    );
    const count = await prisma.notification.count({
      where: { userId: user.id, kind: 'box.ready' },
    });
    expect(count).toBe(1);
  });
});
