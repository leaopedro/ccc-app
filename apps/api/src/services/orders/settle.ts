import { prisma } from '@ccc/db';

import { enqueueBoxNotification } from '../box/notifications.js';
import { awardBadge } from '../garage/awarder.js';
import { checkEligibility as checkOrderEligibility } from '../garage/eligibility/orders.js';
import { assignEventPickupTicket } from '../store/event-pickup.js';
import {
  issueTicketForPaidOrder,
  issueTicketsForMixedOrder,
  OrderNotFoundError,
  OrderNotPendingError,
  type IssueResult,
} from '../tickets/issue.js';

import { fulfillGarageSpotsForOrder } from './garage-fulfillment.js';

type IssueEnv = { readonly TICKET_CODE_SECRET: string };

/**
 * Conquistas de loja (CCC-005), avaliadas DEPOIS que o pedido virou `paid`.
 *
 * Fora da transação que liquida, e não dentro dela, de propósito. O flip de
 * `product` roda em `Serializable` junto do fulfillment de vagas; enfiar mais
 * escritas ali aumenta a chance de falha de serialização num caminho que move
 * dinheiro. A conquista não precisa ser atômica com o pagamento — precisa é
 * de nunca poder desfazê-lo.
 *
 * Por isso o try/catch engole TUDO. Nenhuma conquista vale reverter, ou
 * sequer atrasar, um pagamento que o provedor já confirmou. Se falhar, o
 * membro fica sem a conquista até a próxima compra, e isso é o pior que pode
 * acontecer aqui.
 */
const awardStoreBadges = async (orderId: string): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    if (!order) return;

    await prisma.$transaction(async (tx) => {
      const garage = await tx.garage.findUnique({
        where: { userId: order.userId },
        select: { id: true },
      });
      if (!garage) return;
      const codes = await checkOrderEligibility(tx, order.userId);
      for (const code of codes) {
        await awardBadge(tx, garage.id, code, `order:${orderId}`);
      }
    });
  } catch {
    // Engolido de propósito — ver o bloco acima.
  }
};

export type SettledOrderResult =
  | { kind: 'ticket' | 'extras_only'; issued: IssueResult }
  | { kind: 'product' | 'mixed'; issued?: IssueResult[] }
  | { kind: 'box' };

/**
 * @param livemode Provider mode this charge really happened in, when the
 * caller knows it. Stamped on `Order.livemode` here, in ONE place, because it
 * is the only column no other settlement writer touches and the branches below
 * flip `status` in four different modules.
 *
 * Fix round 2, IMPORTANT. `Order.livemode` defaults to `true` and had exactly
 * two writers — the one-shot scripts/mark-pre-cutover-orders.ts and the admin
 * grant's operator input — so every row created after the migration landed
 * `true` no matter which mode charged it. The finance screen's "exclude test
 * mode" filter therefore excluded pre-cutover rows a human had marked, not
 * test-mode revenue. Production currently points at a Stripe SANDBOX account,
 * so that is not hypothetical.
 *
 * Written unconditionally rather than only on a successful settle: the mode
 * the charge happened in is a fact about the order, not about whether issuing
 * a ticket worked. Omitted ⇒ nothing is written and the column keeps its
 * default.
 */
export const settlePaidOrder = async (
  orderId: string,
  providerRef: string,
  env: IssueEnv,
  intentMetadata?: Record<string, string>,
  livemode?: boolean,
): Promise<SettledOrderResult> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { kind: true, status: true, cartId: true },
  });
  if (!order) throw new OrderNotFoundError(orderId);

  if (livemode !== undefined) {
    await prisma.order.updateMany({
      where: { id: orderId, livemode: { not: livemode } },
      data: { livemode },
    });
  }

  if (order.kind === 'mixed') {
    if (order.status === 'paid') {
      await assignEventPickupTicket(orderId, env);
      return { kind: 'mixed' };
    }
    if (order.status !== 'pending') {
      throw new OrderNotPendingError(orderId, order.status);
    }
    const issued = await issueTicketsForMixedOrder(orderId, providerRef, env);
    await awardStoreBadges(orderId);
    await assignEventPickupTicket(orderId, env);
    return { kind: 'mixed', issued };
  }

  if (order.kind === 'product') {
    if (order.status === 'paid') {
      await assignEventPickupTicket(orderId, env);
      return { kind: order.kind };
    }
    if (order.status !== 'pending') {
      throw new OrderNotPendingError(orderId, order.status);
    }

    await prisma.$transaction(
      async (tx) => {
        // Fulfill BEFORE flipping status: if any non-P2002 error fires from
        // GarageSpot create, the tx rolls back and the order stays 'pending'.
        const result = await fulfillGarageSpotsForOrder(tx, orderId);
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'paid',
            paidAt: new Date(),
            ...(order.cartId ? {} : { providerRef }),
            ...(result.orderIsAllVirtual ? { fulfillmentStatus: 'virtual_complete' } : {}),
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    await awardStoreBadges(orderId);
    await assignEventPickupTicket(orderId, env);
    return { kind: order.kind };
  }

  if (order.kind === 'box') {
    // Fase 4a: only a still-pending box order settles. The cutoff worker runs in
    // parallel and cancels via updateMany(where status:'pending'); a cancelled
    // order must never flip to paid. Non-pending -> throw so the webhook's
    // OrderNotPendingError branch flags a manual refund (Pix has no refund API).
    if (order.status !== 'pending') {
      throw new OrderNotPendingError(orderId, order.status);
    }
    const box = await prisma.monthlyBox.findFirst({
      where: { orderId },
      select: {
        id: true,
        garageId: true,
        membership: { select: { garage: { select: { userId: true } } } },
      },
    });
    if (!box) throw new OrderNotPendingError(orderId, 'cancelled');

    await prisma.$transaction(async (tx) => {
      // Same lock the cutoff worker takes, so the flip and a concurrent cancel
      // serialize on the Garage row.
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${box.garageId} FOR UPDATE`;
      const flipped = await tx.order.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { status: 'paid', paidAt: new Date(), providerRef },
      });
      if (flipped.count === 0) {
        const current = await tx.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        throw new OrderNotPendingError(orderId, current?.status ?? 'unknown');
      }
      await tx.monthlyBox.updateMany({
        where: { id: box.id, status: 'awaiting_payment' },
        data: { status: 'ready' },
      });
      await enqueueBoxNotification(tx, {
        userId: box.membership.garage.userId,
        boxId: box.id,
        kind: 'box.paid',
      });
    });
    return { kind: 'box' };
  }

  const issued = await issueTicketForPaidOrder(orderId, providerRef, env, intentMetadata);
  return { kind: order.kind, issued };
};
