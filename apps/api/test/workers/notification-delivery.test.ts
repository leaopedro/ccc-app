import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { enqueueNotification } from '../../src/services/push/transactional.js';
import { runNotificationDeliveryTick } from '../../src/workers/notification-delivery.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedPending = async (token: string) => {
  const { user } = await createUser({ verified: true });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: token, platform: 'ios' },
  });
  const enq = await enqueueNotification({
    userId: user.id,
    kind: 'box.ready',
    dedupeKey: `box_${Math.random().toString(36).slice(2, 8)}`,
    title: 'Caixa confirmada',
    body: 'ok',
    data: {},
  });
  if (enq.deduped) throw new Error('dedupe');
  return { userId: user.id, id: enq.id };
};

describe('runNotificationDeliveryTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('delivers a pending notification and sets sentAt', async () => {
    const { id } = await seedPending('ExponentPushToken[wok1111111]');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    expect(sender.captured.length).toBe(1);
  });

  it('retries an all-error notification on a later tick, then caps at 5', async () => {
    const token = 'ExponentPushToken[werr111111]';
    const { id } = await seedPending(token);
    const sender = new DevPushSender();
    sender.markError(token);
    // 6 ticks, each spaced past RETRY_INTERVAL via the injected now.
    const base = new Date('2026-08-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 6; i += 1) {
      await runNotificationDeliveryTick({ sender, now: new Date(base + i * 61_000) });
    }
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).toBeNull();
    expect(n.attemptCount).toBe(5); // capped, not 6
  });

  it('does not retry before the retry interval elapses', async () => {
    const token = 'ExponentPushToken[wint111111]';
    const { id } = await seedPending(token);
    const sender = new DevPushSender();
    sender.markError(token);
    const base = new Date('2026-08-16T00:00:00.000Z').getTime();
    await runNotificationDeliveryTick({ sender, now: new Date(base) });
    await runNotificationDeliveryTick({ sender, now: new Date(base + 10_000) }); // <60s later
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.attemptCount).toBe(1); // second tick skipped it
  });

  it('never delivers non-owned kinds (broadcast, badge_awarded)', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[wign111111]', platform: 'ios' },
    });
    // Rows other writers create with a null sentAt that must NOT be pushed here.
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'broadcast',
        dedupeKey: 'bc_1',
        title: 't',
        body: 'b',
        data: {},
      },
    });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'badge_awarded',
        dedupeKey: 'bg_1',
        title: 't',
        body: 'b',
        data: {},
      },
    });
    const sender = new DevPushSender();

    await runNotificationDeliveryTick({ sender, now: new Date() });

    expect(sender.captured.length).toBe(0);
    const rows = await prisma.notification.findMany({
      where: { userId: user.id, kind: { in: ['broadcast', 'badge_awarded'] } },
    });
    expect(rows.every((r) => r.sentAt === null)).toBe(true); // untouched
  });
});
