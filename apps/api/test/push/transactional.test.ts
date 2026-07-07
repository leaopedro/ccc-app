import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { sendTransactionalPush } from '../../src/services/push/transactional.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedToken = (userId: string, token: string) =>
  prisma.deviceToken.create({
    data: { userId, expoPushToken: token, platform: 'ios' },
  });

describe('sendTransactionalPush', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes a Notification row and sends to all tokens', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    await seedToken(user.id, 'ExponentPushToken[b]');
    const sender = new DevPushSender();

    const result = await sendTransactionalPush(
      {
        userId: user.id,
        kind: 'ticket.confirmed',
        dedupeKey: 'order-1',
        title: 'Ingresso confirmado',
        body: 'Bem-vindo!',
        data: { orderId: 'order-1' },
      },
      { sender },
    );

    expect(result).toEqual({ deduped: false, sent: 2, invalidatedTokens: 0 });
    expect(sender.captured).toHaveLength(2);
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeInstanceOf(Date);
  });

  it('is idempotent on duplicate (userId, kind, dedupeKey)', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    const sender = new DevPushSender();

    await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );
    const second = await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );

    expect(second).toEqual({ deduped: true, sent: 0, invalidatedTokens: 0 });
    expect(sender.captured).toHaveLength(1);
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it('skips delivery when user has zero tokens but still records the row', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    const sender = new DevPushSender();

    const result = await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );

    expect(result).toEqual({ deduped: false, sent: 0, invalidatedTokens: 0 });
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeNull();
  });

  it('deletes invalid tokens reported by the sender', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    await seedToken(user.id, 'ExponentPushToken[b]');
    const sender = new DevPushSender();
    sender.markInvalid('ExponentPushToken[a]');

    const result = await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );

    expect(result).toEqual({ deduped: false, sent: 1, invalidatedTokens: 1 });
    const remaining = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(remaining.map((t) => t.expoPushToken)).toEqual(['ExponentPushToken[b]']);
  });

  it('persists destination on the row and embeds route + notificationId in push data', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    const sender = new DevPushSender();

    await sendTransactionalPush(
      {
        userId: user.id,
        kind: 'ticket.confirmed',
        dedupeKey: 'order-1',
        title: 'Ingresso confirmado',
        body: 'pronto',
        data: { orderId: 'order-1' },
        destination: { kind: 'tickets' },
      },
      { sender },
    );

    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1' },
    });
    expect(row.destination).toEqual({ kind: 'tickets' });

    expect(sender.captured).toHaveLength(1);
    const captured = sender.captured[0]!;
    expect(captured.data).toMatchObject({
      orderId: 'order-1',
      route: 'notifications',
      destination: { kind: 'tickets' },
      notificationId: row.id,
    });
  });
});
