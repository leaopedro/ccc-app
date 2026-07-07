import { prisma } from '@jdm/db';
import type { NotificationDestination } from '@jdm/shared/notifications';
import type { PushKind } from '@jdm/shared/push';
import { Prisma } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

import type { PushMessage, PushSender } from './types.js';

export type SendTransactionalPushInput = {
  userId: string;
  kind: PushKind;
  dedupeKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  destination?: NotificationDestination;
};

export type SendTransactionalPushResult = {
  deduped: boolean;
  sent: number;
  invalidatedTokens: number;
};

const buildPushData = (
  notificationId: string,
  input: SendTransactionalPushInput,
): Record<string, unknown> => ({
  ...(input.data ?? {}),
  // Push always lands on the notifications screen first. The mobile app then
  // resolves the destination after the user opens the inbox item.
  route: 'notifications',
  notificationId,
  ...(input.destination ? { destination: input.destination } : {}),
});

export const sendTransactionalPush = async (
  input: SendTransactionalPushInput,
  deps: { sender: PushSender },
): Promise<SendTransactionalPushResult> => {
  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        destination: input.destination
          ? (input.destination as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { deduped: true, sent: 0, invalidatedTokens: 0 };
    }
    throw err;
  }

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: input.userId },
    select: { expoPushToken: true },
  });
  if (tokens.length === 0) {
    return { deduped: false, sent: 0, invalidatedTokens: 0 };
  }

  const pushData = buildPushData(notification.id, input);
  const result = await deps.sender.send(
    tokens.map((t) => {
      const message: PushMessage = {
        to: t.expoPushToken,
        title: input.title,
        body: input.body,
        data: pushData,
      };
      return message;
    }),
  );

  let sent = 0;
  const invalid: string[] = [];
  for (const [token, outcome] of result.outcomesByToken) {
    if (outcome.kind === 'ok') sent += 1;
    else if (outcome.kind === 'invalid-token') invalid.push(token);
  }

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { userId: input.userId, expoPushToken: { in: invalid } },
    });
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: { sentAt: new Date() },
  });

  return { deduped: false, sent, invalidatedTokens: invalid.length };
};
