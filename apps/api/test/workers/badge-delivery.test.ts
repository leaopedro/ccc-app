import { prisma } from '@ccc/db';
import { badgeAwardedGroupBody, BADGE_AWARDED_NOTIFICATION_KIND } from '@ccc/shared/badges-copy';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { runNotificationDeliveryTick } from '../../src/workers/notification-delivery.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedBadgeNotification = async (userId: string, code: string) => {
  await prisma.notification.create({
    data: {
      userId,
      kind: BADGE_AWARDED_NOTIFICATION_KIND,
      title: 'Nova conquista!',
      body: `Título de ${code}`,
      data: { kind: BADGE_AWARDED_NOTIFICATION_KIND, code },
      dedupeKey: `badge:${code}:${userId}`,
    },
  });
};

const seedUserWithToken = async (token: string, email: string) => {
  const { user } = await createUser({ verified: true, email });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: token, platform: 'ios' },
  });
  return user;
};

describe('entrega de badge_awarded', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('manda um push so para N conquistas do mesmo usuario', async () => {
    const user = await seedUserWithToken('ExponentPushToken[bgrp111111]', 'bgrp@jdm.test');
    for (const code of ['EVT-001', 'CAR-001', 'COM-001']) {
      await seedBadgeNotification(user.id, code);
    }
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });

    // Tres linhas na central, um push so. Tres vibracoes no portao do evento
    // e o que este agrupamento existe para evitar.
    expect(sender.captured.length).toBe(1);
    expect(sender.captured[0]!.body).toBe(badgeAwardedGroupBody(3));
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });

  it('usa o corpo da propria conquista quando e so uma', async () => {
    const user = await seedUserWithToken('ExponentPushToken[bone111111]', 'bone@jdm.test');
    await seedBadgeNotification(user.id, 'EVT-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(1);
    expect(sender.captured[0]!.body).toBe('Título de EVT-001');
  });

  it('nao entrega com o killswitch desligado, e nao queima a linha', async () => {
    await prisma.generalSettings.deleteMany();
    await prisma.generalSettings.create({
      data: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });
    const user = await seedUserWithToken('ExponentPushToken[bks1111111]', 'bks@jdm.test');
    await seedBadgeNotification(user.id, 'EVT-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(0);
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.sentAt).toBeNull();
  });

  it('respeita pushPrefs.transactional false', async () => {
    const user = await seedUserWithToken('ExponentPushToken[bpref11111]', 'bpref@jdm.test');
    await prisma.user.update({
      where: { id: user.id },
      data: { pushPrefs: { transactional: false, marketing: false } },
    });
    await seedBadgeNotification(user.id, 'EVT-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(0);
    // A linha da central existe de qualquer jeito: a preferencia governa o
    // push, nao o inbox. Carimbada para nao voltar em todo tick.
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.sentAt).not.toBeNull();
  });

  it('nao mistura usuarios no mesmo push', async () => {
    const a = await seedUserWithToken('ExponentPushToken[bmixa11111]', 'bmixa@jdm.test');
    const b = await seedUserWithToken('ExponentPushToken[bmixb11111]', 'bmixb@jdm.test');
    await seedBadgeNotification(a.id, 'EVT-001');
    await seedBadgeNotification(b.id, 'CAR-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(2);
  });
});
