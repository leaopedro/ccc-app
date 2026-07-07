import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { runEventRemindersTick } from '../../src/workers/event-reminders.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedTicket = async (userId: string, startsAt: Date) => {
  const event = await prisma.event.create({
    data: {
      slug: `evt-${startsAt.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `Evt ${startsAt.toISOString()}`,
      description: 'd',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: { eventId: event.id, name: 'GA', priceCents: 0, quantityTotal: 100 },
  });
  await prisma.ticket.create({
    data: { userId, eventId: event.id, tierId: tier.id, source: 'comp', status: 'valid' },
  });
  return { event, tier };
};

describe('runEventRemindersTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('emits T-24h reminder for events starting in ~24h', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
    const { event } = await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured.length).toBeGreaterThanOrEqual(1);
    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'event.reminder_24h' },
    });
    expect(notif.dedupeKey).toBe(event.id);
  });

  it('emits T-1h reminder for events starting in ~1h', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 59 * 60 * 1000 + 30 * 1000);
    const { event } = await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'event.reminder_1h' },
    });
    expect(notif.dedupeKey).toBe(event.id);
  });

  it('does not double-send across two ticks', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
    await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });
    sender.clear();
    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured).toHaveLength(0);
    const rows = await prisma.notification.findMany({
      where: { userId: user.id, kind: 'event.reminder_24h' },
    });
    expect(rows).toHaveLength(1);
  });

  it('skips events outside both windows', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h out
    await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('skips revoked and used tickets', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
    const { event, tier } = await seedTicket(user.id, startsAt);
    await prisma.ticket.deleteMany({ where: { userId: user.id } });
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'comp',
        status: 'revoked',
      },
    });
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured).toHaveLength(0);
  });
});
