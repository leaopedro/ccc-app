import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { deliverNotification, enqueueNotification } from '../../src/services/push/transactional.js';
import { createUser, resetDatabase } from '../helpers.js';

const seed = async (tokens: string[]) => {
  const { user } = await createUser({ verified: true });
  for (const t of tokens) {
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: t, platform: 'ios' },
    });
  }
  const enq = await enqueueNotification({
    userId: user.id,
    kind: 'box.ready',
    dedupeKey: 'box_1',
    title: 'Caixa confirmada',
    body: 'ok',
    data: { boxId: 'box_1' },
    destination: { kind: 'internal_path', path: '/caixa' },
  });
  if (enq.deduped) throw new Error('unexpected dedupe');
  return { userId: user.id, id: enq.id };
};

describe('deliverNotification', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marks sentAt on success', async () => {
    const { id } = await seed(['ExponentPushToken[ok11111111]']);
    const sender = new DevPushSender();
    const r = await deliverNotification(id, { sender });
    expect(r).toMatchObject({ sent: 1, delivered: true });
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
  });

  it('leaves sentAt null and bumps attempt on all-error', async () => {
    const { id } = await seed(['ExponentPushToken[err11111111]']);
    const sender = new DevPushSender();
    sender.markError('ExponentPushToken[err11111111]');
    const r = await deliverNotification(id, { sender });
    expect(r.delivered).toBe(false);
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).toBeNull();
    expect(n.attemptCount).toBe(1);
    expect(n.failureCode).toBe('send_error');
    expect(n.lastAttemptAt).not.toBeNull();
  });

  it('is terminal (sentAt set) when all tokens invalid, and deletes them', async () => {
    const { id, userId } = await seed(['ExponentPushToken[bad11111111]']);
    const sender = new DevPushSender();
    sender.markInvalid('ExponentPushToken[bad11111111]');
    const r = await deliverNotification(id, { sender });
    expect(r).toMatchObject({ delivered: true, invalidatedTokens: 1 });
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    const tokens = await prisma.deviceToken.count({ where: { userId } });
    expect(tokens).toBe(0);
  });

  it('is terminal when the user has no device tokens', async () => {
    const { id } = await seed([]);
    const sender = new DevPushSender();
    const r = await deliverNotification(id, { sender });
    expect(r.delivered).toBe(true);
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
  });

  it('is a no-op when already sent', async () => {
    const { id } = await seed(['ExponentPushToken[ok22222222]']);
    const sender = new DevPushSender();
    await deliverNotification(id, { sender });
    const r = await deliverNotification(id, { sender });
    expect(r.delivered).toBe(true);
  });

  it('delivers only once under concurrent calls (claim wins once)', async () => {
    const { id } = await seed(['ExponentPushToken[ok33333333]']);
    const sender = new DevPushSender();
    // Two concurrent deliveries of the same pending row: the compare-and-swap
    // claim lets exactly one send; the other bails.
    await Promise.all([deliverNotification(id, { sender }), deliverNotification(id, { sender })]);
    expect(sender.captured.length).toBe(1);
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    expect(n.attemptCount).toBe(1);
  });

  it('persists a failure marker and rethrows when the sender throws', async () => {
    const { id } = await seed(['ExponentPushToken[thr11111111]']);
    const throwingSender = {
      send: () => Promise.reject(new Error('sender boom')),
    };
    await expect(deliverNotification(id, { sender: throwingSender })).rejects.toThrow(
      'sender boom',
    );
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).toBeNull();
    expect(n.attemptCount).toBe(1); // attempt consumed by the claim, not silently lost
    expect(n.failureCode).toBe('send_exception');
  });

  it('clears a stale failureCode when a later attempt succeeds', async () => {
    const { id } = await seed(['ExponentPushToken[recv111111]']);
    const failing = new DevPushSender();
    failing.markError('ExponentPushToken[recv111111]');
    await deliverNotification(id, { sender: failing });
    let n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.failureCode).toBe('send_error');

    // A subsequent successful attempt must not leave the row looking failed.
    await deliverNotification(id, { sender: new DevPushSender() });
    n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    expect(n.failureCode).toBeNull();
  });
});
