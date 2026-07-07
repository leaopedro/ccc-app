import { prisma } from '@jdm/db';

import { releaseAllReservationsForOrders } from './expire.js';

export type PrepareCancelOrderOutcome =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'not_pending'; status: string }
  | {
      kind: 'ok';
      order: {
        id: string;
        provider: 'stripe' | 'abacatepay';
        providerRef: string | null;
      };
    };

export const prepareCancelPendingOrder = async (
  orderId: string,
  ownerId: string,
): Promise<PrepareCancelOrderOutcome> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      provider: true,
      providerRef: true,
    },
  });

  if (!order) return { kind: 'not_found' };
  if (order.userId !== ownerId) return { kind: 'forbidden' };
  if (order.status !== 'pending') return { kind: 'not_pending', status: order.status };

  return {
    kind: 'ok',
    order: {
      id: order.id,
      provider: order.provider,
      providerRef: order.providerRef,
    },
  };
};

export type CancelOrderOutcome =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'not_pending'; status: string }
  | {
      kind: 'ok';
      order: {
        id: string;
        status: 'cancelled';
      };
    };

export const cancelPendingOrder = async (
  orderId: string,
  ownerId: string,
): Promise<CancelOrderOutcome> => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!order) return { kind: 'not_found' };
    if (order.userId !== ownerId) return { kind: 'forbidden' };
    if (order.status !== 'pending') return { kind: 'not_pending', status: order.status };

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'cancelled', fulfillmentStatus: 'cancelled' },
    });
    if (updated.count !== 1) {
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      return { kind: 'not_pending', status: current?.status ?? 'unknown' };
    }

    await releaseAllReservationsForOrders(tx, [orderId]);

    return {
      kind: 'ok',
      order: {
        id: order.id,
        status: 'cancelled',
      },
    };
  });
};
