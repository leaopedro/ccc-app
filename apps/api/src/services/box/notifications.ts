import type { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';

import { enqueueNotification } from '../push/transactional.js';

export type BoxPushKind = 'box.paid' | 'box.ready' | 'box.shipped' | 'box.delivered';

const COPY: Record<BoxPushKind, { title: string; body: string }> = {
  'box.paid': {
    title: 'Pagamento confirmado',
    body: 'Recebemos o pagamento. Sua caixa está confirmada.',
  },
  'box.ready': {
    title: 'Caixa confirmada',
    body: 'Sua caixa deste mês foi fechada e entrou na fila.',
  },
  'box.shipped': {
    title: 'Caixa enviada',
    body: 'Sua caixa saiu para entrega.',
  },
  'box.delivered': {
    title: 'Caixa entregue',
    body: 'Sua caixa foi entregue. Aproveite.',
  },
};

/**
 * What the member still has to lose when the cutoff arrives. The three cases
 * are different asks, so they get different bodies: an empty box needs a
 * selection, an open one needs a confirmation, and an awaiting_payment one
 * needs the payment. One `kind` for all three — the dedupe key is the box, so
 * a member is warned once per cycle whichever state they are in.
 */
export type BoxCutoffReminderCase = 'empty' | 'unconfirmed' | 'unpaid';

const CUTOFF_SOON_COPY: Record<BoxCutoffReminderCase, { title: string; body: string }> = {
  empty: {
    title: 'Sua caixa fecha em breve',
    body: 'Você ainda não escolheu nenhum item. Monte a sua antes do corte.',
  },
  unconfirmed: {
    title: 'Sua caixa fecha em breve',
    body: 'Confirme sua seleção antes do corte para não perder a caixa deste mês.',
  },
  unpaid: {
    title: 'Sua caixa fecha em breve',
    body: 'Falta o pagamento. Sem ele, enviamos só o que cabe no seu budget.',
  },
};

/**
 * Warn a member before the cutoff closes their box.
 *
 * Idempotency is the `@@unique([userId, kind, dedupeKey])` on Notification,
 * with the box as the key: the worker may re-run every minute across the whole
 * warning window and the member still gets exactly one push.
 */
export const enqueueBoxCutoffReminder = async (
  tx: Prisma.TransactionClient | typeof prisma,
  input: { userId: string; boxId: string; case: BoxCutoffReminderCase },
): Promise<void> => {
  const copy = CUTOFF_SOON_COPY[input.case];
  await enqueueNotification(
    {
      userId: input.userId,
      kind: 'box.cutoff_soon',
      dedupeKey: input.boxId,
      title: copy.title,
      body: copy.body,
      data: { boxId: input.boxId },
      destination: { kind: 'internal_path', path: '/caixa' },
    },
    tx,
  );
};

// Enqueue a box milestone notification INSIDE a state-change transaction, so
// the inbox row is durable with the transition (a crash cannot lose it). The
// delivery worker sends it. dedupeKey = boxId. Destination lands the member on
// the Caixa screen after opening the inbox item.
export const enqueueBoxNotification = async (
  tx: Prisma.TransactionClient,
  input: { userId: string; boxId: string; kind: BoxPushKind },
): Promise<void> => {
  const copy = COPY[input.kind];
  await enqueueNotification(
    {
      userId: input.userId,
      kind: input.kind,
      dedupeKey: input.boxId,
      title: copy.title,
      body: copy.body,
      data: { boxId: input.boxId },
      destination: { kind: 'internal_path', path: '/caixa' },
    },
    tx,
  );
};
