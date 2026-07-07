import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';

import { mintPickupVouchersForOrderTx } from './pickup-voucher.js';

type Tx = Prisma.TransactionClient;

type AssignEnv = { readonly TICKET_CODE_SECRET: string };

type CheckoutCart = {
  items: Array<{
    kind: 'ticket' | 'extras_only' | 'product';
    eventId: string | null;
    variant: {
      product: {
        allowPickup: boolean;
        allowShip: boolean;
      };
    } | null;
  }>;
};

export class EventPickupValidationError extends Error {
  readonly code = 'EVENT_PICKUP_INVALID' as const;

  constructor(
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'EventPickupValidationError';
  }
}

export class EventPickupAssignmentUnavailableError extends Error {
  readonly code = 'EVENT_PICKUP_ASSIGNMENT_UNAVAILABLE' as const;

  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly eventId: string,
  ) {
    super(`event pickup assignment unavailable for order ${orderId}`);
    this.name = 'EventPickupAssignmentUnavailableError';
  }
}

export const validateEventPickupSelection = async (
  userId: string,
  pickupEventId: string,
  cart: CheckoutCart,
): Promise<void> => {
  const settings = await prisma.storeSettings.upsert({
    where: { id: 'store_default' },
    update: {},
    create: { id: 'store_default' },
    select: { eventPickupEnabled: true },
  });

  if (!settings.eventPickupEnabled) {
    throw new EventPickupValidationError('event pickup is disabled');
  }

  const hasProductItem = cart.items.some((item) => item.kind === 'product');
  if (!hasProductItem) {
    throw new EventPickupValidationError('event pickup requires at least one product item');
  }

  const hasShipOnlyProduct = cart.items.some(
    (item) =>
      item.kind === 'product' &&
      !!item.variant?.product.allowShip &&
      !item.variant.product.allowPickup,
  );
  if (hasShipOnlyProduct) {
    throw new EventPickupValidationError('event pickup is unavailable for shipping-only products');
  }

  const event = await prisma.event.findFirst({
    where: {
      id: pickupEventId,
      status: 'published',
      startsAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!event) {
    throw new EventPickupValidationError('pickup event not found');
  }

  const hasExistingTicket =
    (await prisma.ticket.count({
      where: { userId, eventId: pickupEventId, status: 'valid' },
    })) > 0;

  const hasInOrderTicket = cart.items.some(
    (item) => item.kind === 'ticket' && item.eventId === pickupEventId,
  );

  if (!hasExistingTicket && !hasInOrderTicket) {
    throw new EventPickupValidationError('event pickup requires an eligible ticket');
  }
};

export const assignEventPickupTicket = async (
  orderId: string,
  env: AssignEnv,
): Promise<string | null> => {
  return prisma.$transaction(async (tx) => assignEventPickupTicketTx(orderId, tx, env));
};

export const assignEventPickupTicketTx = async (
  orderId: string,
  tx: Tx,
  env: AssignEnv,
): Promise<string | null> => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      pickupEventId: true,
      pickupTicketId: true,
    },
  });

  if (!order?.pickupEventId) {
    return null;
  }

  if (order.pickupTicketId) {
    await mintPickupVouchersForOrderTx(
      order.id,
      order.pickupTicketId,
      order.pickupEventId,
      tx,
      env,
    );
    return order.pickupTicketId;
  }

  const sameOrderTicket = await tx.ticket.findFirst({
    where: {
      orderId: order.id,
      userId: order.userId,
      eventId: order.pickupEventId,
      status: 'valid',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });

  const ticket =
    sameOrderTicket ??
    (await tx.ticket.findFirst({
      where: {
        userId: order.userId,
        eventId: order.pickupEventId,
        status: 'valid',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    }));

  if (!ticket) {
    throw new EventPickupAssignmentUnavailableError(order.id, order.userId, order.pickupEventId);
  }

  await tx.order.update({
    where: { id: order.id },
    data: { pickupTicketId: ticket.id },
  });

  await mintPickupVouchersForOrderTx(order.id, ticket.id, order.pickupEventId, tx, env);

  return ticket.id;
};
