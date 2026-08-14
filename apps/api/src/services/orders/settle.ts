import { prisma } from '@ccc/db';

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

export type SettledOrderResult =
  | { kind: 'ticket' | 'extras_only'; issued: IssueResult }
  | { kind: 'product' | 'mixed'; issued?: IssueResult[] }
  | { kind: 'box' };

export const settlePaidOrder = async (
  orderId: string,
  providerRef: string,
  env: IssueEnv,
  intentMetadata?: Record<string, string>,
): Promise<SettledOrderResult> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { kind: true, status: true, cartId: true },
  });
  if (!order) throw new OrderNotFoundError(orderId);

  if (order.kind === 'mixed') {
    if (order.status === 'paid') {
      await assignEventPickupTicket(orderId, env);
      return { kind: 'mixed' };
    }
    if (order.status !== 'pending') {
      throw new OrderNotPendingError(orderId, order.status);
    }
    const issued = await issueTicketsForMixedOrder(orderId, providerRef, env);
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
      select: { id: true, garageId: true },
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
    });
    return { kind: 'box' };
  }

  const issued = await issueTicketForPaidOrder(orderId, providerRef, env, intentMetadata);
  return { kind: order.kind, issued };
};
