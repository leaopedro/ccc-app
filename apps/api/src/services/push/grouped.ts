import { prisma } from '@ccc/db';

import type { PushMessage, PushSender } from './types.js';

export type GroupedDeliveryInput = {
  userId: string;
  notificationIds: string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type GroupedDeliveryResult = {
  sent: number;
  invalidatedTokens: number;
  delivered: boolean;
};

/**
 * Entrega N linhas de Notification como UM push.
 *
 * Existe porque o awarder é por código e os hooks iteram uma lista: um
 * check-in que destrava três conquistas cria três linhas com `dedupeKey`
 * diferentes, e o índice único não as funde. Entregar linha a linha seriam
 * três vibrações no portão do evento, com o mesmo título nas três.
 *
 * A reivindicação é um `updateMany` sobre o grupo, mais fraca que o
 * compare-and-swap por linha de `deliverNotification`: duas réplicas que
 * observem o mesmo grupo podem ambas reivindicar. Isto é seguro hoje só
 * porque `railway.json` fixa `numReplicas: 1` — um único processo roda este
 * cron, e a guarda de não-sobreposição em memória do worker (o `running`
 * boolean em `startNotificationDeliveryWorker`) basta para serializar os
 * ticks desse processo. Essa guarda NÃO protege entre réplicas: subir o
 * número de réplicas deixa dois ticks disputarem o mesmo grupo e entregar um
 * push duplicado. A troca é consciente: duplicar um push de celebração é
 * barato, e o alvo aqui é não vibrar N vezes, não ser exactly-once — mas
 * quem escalar a API para mais de uma réplica precisa saber deste custo.
 */
export const deliverGroupedNotifications = async (
  input: GroupedDeliveryInput,
  deps: { sender: PushSender; now?: Date },
): Promise<GroupedDeliveryResult> => {
  const now = deps.now ?? new Date();

  const claim = await prisma.notification.updateMany({
    where: { id: { in: input.notificationIds }, sentAt: null },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count === 0) return { sent: 0, invalidatedTokens: 0, delivered: true };

  const markSent = async () => {
    await prisma.notification.updateMany({
      where: { id: { in: input.notificationIds }, sentAt: null },
      data: { sentAt: now, failureCode: null },
    });
  };

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: input.userId },
    select: { expoPushToken: true },
  });
  if (tokens.length === 0) {
    await markSent();
    return { sent: 0, invalidatedTokens: 0, delivered: true };
  }

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.expoPushToken,
    title: input.title,
    body: input.body,
    data: input.data,
  }));

  const result = await deps.sender.send(messages);

  let sent = 0;
  const invalid: string[] = [];
  let hasError = false;
  for (const [token, outcome] of result.outcomesByToken) {
    if (outcome.kind === 'ok') sent += 1;
    else if (outcome.kind === 'invalid-token') invalid.push(token);
    else hasError = true;
  }

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { userId: input.userId, expoPushToken: { in: invalid } },
    });
  }

  if (sent > 0 || !hasError) {
    await markSent();
    return { sent, invalidatedTokens: invalid.length, delivered: true };
  }

  await prisma.notification.updateMany({
    where: { id: { in: input.notificationIds }, sentAt: null },
    data: { failureCode: 'send_error' },
  });
  return { sent, invalidatedTokens: invalid.length, delivered: false };
};

/** Carimba o grupo como resolvido sem enviar nada. Usado pelo gate de preferência. */
export const suppressGroup = async (notificationIds: string[], now: Date): Promise<void> => {
  await prisma.notification.updateMany({
    where: { id: { in: notificationIds }, sentAt: null },
    data: { sentAt: now, failureCode: null },
  });
};
