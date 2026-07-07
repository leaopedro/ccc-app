import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

const revokeOwnedTickets = async (tx: Tx, orderId: string): Promise<string[]> => {
  const tickets = await tx.ticket.findMany({
    where: { orderId, status: 'valid' },
    select: { id: true },
  });
  if (tickets.length === 0) return [];

  const ticketIds = tickets.map((t) => t.id);

  await tx.ticket.updateMany({
    where: { id: { in: ticketIds }, status: 'valid' },
    data: { status: 'revoked' },
  });

  await tx.ticketExtraItem.updateMany({
    where: { ticketId: { in: ticketIds }, status: 'valid' },
    data: { status: 'revoked' },
  });

  return ticketIds;
};

const revokeExtrasOnlyItems = async (tx: Tx, orderId: string): Promise<void> => {
  const orderExtras = await tx.orderExtra.findMany({
    where: { orderId },
    select: { extraId: true },
  });
  if (orderExtras.length === 0) return;

  const extraIds = orderExtras.map((oe) => oe.extraId);

  await tx.ticketExtraItem.updateMany({
    where: { extraId: { in: extraIds }, status: 'valid' },
    data: { status: 'revoked' },
  });
};

export const revokeTicketsForRefundedOrder = async (orderId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { kind: true },
    });
    if (!order) return;

    if (order.kind === 'extras_only') {
      await revokeExtrasOnlyItems(tx, orderId);
    } else {
      const revokedTicketIds = await revokeOwnedTickets(tx, orderId);
      if (order.kind === 'mixed' && revokedTicketIds.length === 0) {
        await revokeExtrasOnlyItems(tx, orderId);
      }
    }

    await tx.pickupVoucher.updateMany({
      where: { orderId, status: 'valid' },
      data: { status: 'revoked' },
    });
  });
};
