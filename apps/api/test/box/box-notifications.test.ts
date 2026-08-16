import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { sendBoxPush } from '../../src/services/box/notifications.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('sendBoxPush', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a notification with box copy, /caixa destination and boxId dedupe', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const sender = new DevPushSender();

    await sendBoxPush(sender, { userId: user.id, boxId: 'box_1', kind: 'box.shipped' });

    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'box.shipped' },
    });
    expect(notif.dedupeKey).toBe('box_1');
    expect(notif.title).toBe('Caixa enviada');
    expect(notif.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
    expect(sender.captured.length).toBe(1);
  });

  it('dedupes a repeated send for the same box and kind', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const sender = new DevPushSender();

    await sendBoxPush(sender, { userId: user.id, boxId: 'box_1', kind: 'box.ready' });
    await sendBoxPush(sender, { userId: user.id, boxId: 'box_1', kind: 'box.ready' });

    const count = await prisma.notification.count({
      where: { userId: user.id, kind: 'box.ready' },
    });
    expect(count).toBe(1);
  });
});
