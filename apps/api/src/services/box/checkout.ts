import { prisma } from '@ccc/db';

import type { AbacatePayClient } from '../abacatepay/index.js';

const MIN_WINDOW_MS = 60_000;

export type CheckoutResult =
  | { kind: 'ok'; brCode: string; amountCents: number; expiresAt: string }
  | { kind: 'not_found' }
  | { kind: 'not_awaiting' }
  | { kind: 'locked' }
  | { kind: 'upstream' };

const monthYear = (cycleKey: string): string => cycleKey.slice(0, 7);

export const checkoutBoxOrder = async (args: {
  userId: string;
  membershipId: string;
  abacatepay: AbacatePayClient;
}): Promise<CheckoutResult> => {
  // Phase A: under the Garage lock, validate + short-circuit on an active charge.
  const phaseA = await prisma.$transaction(async (tx) => {
    const boxRef = await tx.monthlyBox.findFirst({
      where: { membershipId: args.membershipId },
      orderBy: { cycleStart: 'desc' },
      select: { id: true, garageId: true },
    });
    if (!boxRef) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRef.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: boxRef.id },
      select: { id: true, status: true, cutoffAt: true, cycleKey: true, orderId: true },
    });
    if (!box || !box.orderId) return { kind: 'not_found' as const };
    if (box.status !== 'awaiting_payment') return { kind: 'not_awaiting' as const };
    if (box.cutoffAt.getTime() - Date.now() < MIN_WINDOW_MS) return { kind: 'locked' as const };
    const order = await tx.order.findUnique({
      where: { id: box.orderId },
      select: { id: true, status: true, amountCents: true, providerRef: true, brCode: true },
    });
    if (!order || order.status !== 'pending') return { kind: 'not_awaiting' as const };
    if (order.providerRef && order.brCode) {
      // Active charge (expiry = cutoff; we are before cutoff). Reuse, no provider call.
      return {
        kind: 'reuse' as const,
        brCode: order.brCode,
        amountCents: order.amountCents,
        expiresAt: box.cutoffAt.toISOString(),
      };
    }
    return {
      kind: 'create' as const,
      orderId: order.id,
      boxId: box.id,
      amountCents: order.amountCents,
      cutoffAt: box.cutoffAt,
      cycleKey: box.cycleKey,
    };
  });

  if (phaseA.kind !== 'create') {
    if (phaseA.kind === 'reuse') {
      return {
        kind: 'ok',
        brCode: phaseA.brCode,
        amountCents: phaseA.amountCents,
        expiresAt: phaseA.expiresAt,
      };
    }
    return phaseA;
  }

  // Phase B: create the Pix billing off-lock (external HTTP).
  const expiresInSeconds = Math.floor((phaseA.cutoffAt.getTime() - Date.now()) / 1000);
  let billing;
  try {
    billing = await args.abacatepay.createPixBilling({
      amountCents: phaseA.amountCents,
      description: `Caixa ${monthYear(phaseA.cycleKey)}`,
      expiresInSeconds,
      metadata: { orderId: phaseA.orderId, boxId: phaseA.boxId, userId: args.userId },
    });
  } catch {
    return { kind: 'upstream' };
  }

  // Phase C: under the lock again, stamp only if still pending.
  return prisma.$transaction(async (tx) => {
    const boxRow = await tx.monthlyBox.findUnique({
      where: { id: phaseA.boxId },
      select: { garageId: true },
    });
    if (!boxRow) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRow.garageId} FOR UPDATE`;
    const stamped = await tx.order.updateMany({
      where: { id: phaseA.orderId, status: 'pending', providerRef: null },
      data: { providerRef: billing.id, brCode: billing.brCode },
    });
    if (stamped.count === 0) {
      // Either the cutoff worker cancelled between phases, or a concurrent
      // checkout already stamped providerRef first. Either way, do not
      // clobber. This orphaned billing expires at cutoff; the loser's next
      // checkout hits Phase A's reuse path and gets the winner's brCode.
      return { kind: 'locked' as const };
    }
    return {
      kind: 'ok' as const,
      brCode: billing.brCode,
      amountCents: phaseA.amountCents,
      expiresAt: phaseA.cutoffAt.toISOString(),
    };
  });
};
