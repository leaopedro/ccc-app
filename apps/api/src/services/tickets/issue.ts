import { prisma } from '@ccc/db';

import { signQrCode } from '../../lib/qr.js';
import { fulfillGarageSpotsForOrder } from '../orders/garage-fulfillment.js';

import { signTicketCode } from './codes.js';
import { lockTicketTuple } from './locks.js';

type IssueEnv = { readonly TICKET_CODE_SECRET: string };

export type IssueResult = {
  ticketId: string;
  code: string;
  userId: string;
  eventId: string;
  eventTitle: string;
};

export class OrderNotFoundError extends Error {
  readonly code = 'ORDER_NOT_FOUND' as const;
  constructor(public readonly orderId: string) {
    super(`order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderNotPendingError extends Error {
  readonly code = 'ORDER_NOT_PENDING' as const;
  constructor(
    public readonly orderId: string,
    public readonly status: string,
  ) {
    super(`order is not pending (id=${orderId}, status=${status})`);
    this.name = 'OrderNotPendingError';
  }
}

export class TicketAlreadyExistsForEventError extends Error {
  readonly code = 'TICKET_ALREADY_EXISTS_FOR_EVENT' as const;
  constructor(
    public readonly userId: string,
    public readonly eventId: string,
    public readonly maxTicketsPerUser: number | null,
    public readonly existingValidCount: number,
  ) {
    super(
      `user ${userId} reached ticket limit (${existingValidCount}/${maxTicketsPerUser ?? '∞'}) for event ${eventId}`,
    );
    this.name = 'TicketAlreadyExistsForEventError';
  }
}

export class OrderPaidWithoutTicketError extends Error {
  readonly code = 'ORDER_PAID_WITHOUT_TICKET' as const;
  constructor(public readonly orderId: string) {
    super(`order ${orderId} is paid but has no ticket (data integrity error)`);
    this.name = 'OrderPaidWithoutTicketError';
  }
}

export class TicketRevokedForExtrasOnlyError extends Error {
  readonly code = 'TICKET_REVOKED_FOR_EXTRAS_ONLY' as const;
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly eventId: string,
  ) {
    super(`extras_only order ${orderId} but no valid ticket for user ${userId} event ${eventId}`);
    this.name = 'TicketRevokedForExtrasOnlyError';
  }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type TicketMeta = {
  extras: string[];
  carId?: string | undefined;
  licensePlate?: string | undefined;
  nickname?: string | undefined;
};

function parseTicketsMeta(metadata: Record<string, string> | undefined): TicketMeta[] {
  const raw = metadata?.tickets;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) {
        return { extras: [] };
      }
      const obj = entry as Record<string, unknown>;
      return {
        extras: Array.isArray(obj.e) ? (obj.e as string[]) : [],
        carId: typeof obj.c === 'string' ? obj.c : undefined,
        licensePlate: typeof obj.p === 'string' ? obj.p : undefined,
        nickname: typeof obj.n === 'string' ? obj.n : undefined,
      };
    });
  } catch {
    return [];
  }
}

const upsertExtraItemsFromMeta = async (
  ticketId: string,
  extraIds: string[],
  env: IssueEnv,
  tx: Tx,
): Promise<void> => {
  for (const extraId of extraIds) {
    await tx.ticketExtraItem.upsert({
      where: { ticketId_extraId: { ticketId, extraId } },
      create: {
        ticketId,
        extraId,
        code: signQrCode('e', `${ticketId}-${extraId}`, env),
        status: 'valid',
      },
      update: {},
    });
  }
};

// Fallback for single-ticket orders without metadata: read extras from OrderExtra rows.
// Safe only for non-mixed orders (single event), where every OrderExtra belongs
// to that event's ticket. For mixed orders, use upsertExtraItemsFromOrderItemsForEvent.
const upsertExtraItemsFromOrder = async (
  orderId: string,
  ticketId: string,
  env: IssueEnv,
  tx: Tx,
): Promise<void> => {
  const orderExtras = await tx.orderExtra.findMany({
    where: { orderId },
    select: { extraId: true },
  });
  await upsertExtraItemsFromMeta(
    ticketId,
    orderExtras.map((oe) => oe.extraId),
    env,
    tx,
  );
};

// Mixed-order safe extras fallback: read extras scoped to a single event from
// OrderItem rows (kind='extras') so we never attach another event's extras
// to this ticket.
const upsertExtraItemsFromOrderItemsForEvent = async (
  orderId: string,
  eventId: string,
  ticketId: string,
  env: IssueEnv,
  tx: Tx,
): Promise<void> => {
  const extraItems = await tx.orderItem.findMany({
    where: { orderId, kind: 'extras', eventId },
    select: { extraId: true },
  });
  const extraIds = extraItems
    .map((row) => row.extraId)
    .filter((id): id is string => typeof id === 'string');
  if (extraIds.length === 0) return;
  await upsertExtraItemsFromMeta(ticketId, extraIds, env, tx);
};

export const issueTicketForPaidOrder = async (
  orderId: string,
  providerRef: string,
  env: IssueEnv,
  intentMetadata?: Record<string, string>,
): Promise<IssueResult> => {
  const ticketsMeta = parseTicketsMeta(intentMetadata);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { event: { select: { title: true, maxTicketsPerUser: true } } },
    });
    if (!order) throw new OrderNotFoundError(orderId);

    if (order.kind === 'product' || order.kind === 'mixed') {
      throw new Error(
        `issueTicketForPaidOrder called on non-ticket order ${orderId} (kind=${order.kind})`,
      );
    }
    if (!order.eventId || !order.tierId || !order.event) {
      throw new Error(`order ${orderId} missing eventId/tierId/event for ticket issuance`);
    }
    const eventId = order.eventId;
    const tierId = order.tierId;
    const eventBundle = order.event;

    await lockTicketTuple(tx, order.userId, eventId);

    if (order.kind === 'extras_only') {
      return issueExtrasOnly({ ...order, eventId, event: eventBundle }, providerRef, env, tx);
    }

    if (order.status === 'paid') {
      const existing = await tx.ticket.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      if (existing.length === 0) throw new OrderPaidWithoutTicketError(orderId);
      for (let i = 0; i < existing.length; i++) {
        const meta = ticketsMeta[i];
        if (meta && meta.extras.length > 0) {
          await upsertExtraItemsFromMeta(existing[i]!.id, meta.extras, env, tx);
        } else if (existing.length === 1 && ticketsMeta.length === 0) {
          await upsertExtraItemsFromOrder(orderId, existing[0]!.id, env, tx);
        }
      }
      const first = existing[0]!;
      return {
        ticketId: first.id,
        code: signTicketCode(first.id, env),
        userId: first.userId,
        eventId: first.eventId,
        eventTitle: eventBundle.title,
      };
    }

    if (order.status !== 'pending') {
      throw new OrderNotPendingError(orderId, order.status);
    }

    if (eventBundle.maxTicketsPerUser !== null) {
      const existingValidCount = await tx.ticket.count({
        where: { userId: order.userId, eventId, status: 'valid' },
      });
      if (existingValidCount + order.quantity > eventBundle.maxTicketsPerUser) {
        throw new TicketAlreadyExistsForEventError(
          order.userId,
          eventId,
          eventBundle.maxTicketsPerUser,
          existingValidCount,
        );
      }
    }

    const ticketCount = order.quantity;
    const tickets: { id: string }[] = [];

    for (let i = 0; i < ticketCount; i++) {
      const meta = ticketsMeta[i];
      const ticket = await tx.ticket.create({
        data: {
          orderId: order.id,
          userId: order.userId,
          eventId,
          tierId,
          source: 'purchase',
          status: 'valid',
          ...(meta?.carId ? { carId: meta.carId } : {}),
          ...(meta?.licensePlate ? { licensePlate: meta.licensePlate } : {}),
          ...(meta?.nickname ? { nickname: meta.nickname } : {}),
        },
      });
      tickets.push(ticket);
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'paid', paidAt: new Date(), ...(order.cartId ? {} : { providerRef }) },
    });

    for (let i = 0; i < tickets.length; i++) {
      const meta = ticketsMeta[i];
      if (meta && meta.extras.length > 0) {
        await upsertExtraItemsFromMeta(tickets[i]!.id, meta.extras, env, tx);
      } else if (ticketCount === 1 && ticketsMeta.length === 0) {
        await upsertExtraItemsFromOrder(orderId, tickets[0]!.id, env, tx);
      }
    }

    const first = tickets[0]!;
    return {
      ticketId: first.id,
      code: signTicketCode(first.id, env),
      userId: order.userId,
      eventId,
      eventTitle: eventBundle.title,
    };
  });
};

const issueExtrasOnly = async (
  order: {
    id: string;
    userId: string;
    eventId: string;
    status: string;
    cartId: string | null;
    event: { title: string };
  },
  providerRef: string,
  env: IssueEnv,
  tx: Tx,
): Promise<IssueResult> => {
  const ticket = await tx.ticket.findFirst({
    where: { userId: order.userId, eventId: order.eventId, status: 'valid' },
  });
  if (!ticket) {
    throw new TicketRevokedForExtrasOnlyError(order.id, order.userId, order.eventId);
  }

  if (order.status === 'paid') {
    await upsertExtraItemsFromOrder(order.id, ticket.id, env, tx);
    return {
      ticketId: ticket.id,
      code: signTicketCode(ticket.id, env),
      userId: order.userId,
      eventId: order.eventId,
      eventTitle: order.event.title,
    };
  }

  if (order.status !== 'pending') {
    throw new OrderNotPendingError(order.id, order.status);
  }

  await tx.order.update({
    where: { id: order.id },
    data: { status: 'paid', paidAt: new Date(), ...(order.cartId ? {} : { providerRef }) },
  });

  await upsertExtraItemsFromOrder(order.id, ticket.id, env, tx);

  return {
    ticketId: ticket.id,
    code: signTicketCode(ticket.id, env),
    userId: order.userId,
    eventId: order.eventId,
    eventTitle: order.event.title,
  };
};

function parseOrderItemTickets(raw: unknown): TicketMeta[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return { extras: [] };
    const obj = entry as Record<string, unknown>;
    return {
      extras: Array.isArray(obj['extras']) ? (obj['extras'] as string[]) : [],
      carId: typeof obj['carId'] === 'string' ? obj['carId'] : undefined,
      licensePlate: typeof obj['licensePlate'] === 'string' ? obj['licensePlate'] : undefined,
      nickname: typeof obj['nickname'] === 'string' ? obj['nickname'] : undefined,
    };
  });
}

export const issueTicketsForMixedOrder = async (
  orderId: string,
  providerRef: string,
  env: IssueEnv,
): Promise<IssueResult[]> => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true, cartId: true },
    });
    if (!order) throw new OrderNotFoundError(orderId);

    if (order.status === 'paid') {
      const existing = await tx.ticket.findMany({
        where: { orderId },
        include: { event: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return existing.map((t) => ({
        ticketId: t.id,
        code: signTicketCode(t.id, env),
        userId: t.userId,
        eventId: t.eventId,
        eventTitle: t.event.title,
      }));
    }

    const ticketItems = await tx.orderItem.findMany({
      where: { orderId, kind: 'ticket' },
      select: {
        id: true,
        tierId: true,
        eventId: true,
        quantity: true,
        tickets: true,
        event: { select: { title: true, maxTicketsPerUser: true } },
      },
    });

    const results: IssueResult[] = [];

    for (const item of ticketItems) {
      if (!item.tierId || !item.eventId || !item.event) continue;

      const ticketsMeta = parseOrderItemTickets(item.tickets);

      await lockTicketTuple(tx, order.userId, item.eventId);

      if (item.event.maxTicketsPerUser !== null) {
        const existingValidCount = await tx.ticket.count({
          where: { userId: order.userId, eventId: item.eventId, status: 'valid' },
        });
        if (existingValidCount + item.quantity > item.event.maxTicketsPerUser) {
          throw new TicketAlreadyExistsForEventError(
            order.userId,
            item.eventId,
            item.event.maxTicketsPerUser,
            existingValidCount,
          );
        }
      }

      for (let i = 0; i < item.quantity; i++) {
        const meta = ticketsMeta[i];
        const ticket = await tx.ticket.create({
          data: {
            orderId: order.id,
            userId: order.userId,
            eventId: item.eventId,
            tierId: item.tierId,
            source: 'purchase',
            status: 'valid',
            ...(meta?.carId ? { carId: meta.carId } : {}),
            ...(meta?.licensePlate ? { licensePlate: meta.licensePlate } : {}),
            ...(meta?.nickname ? { nickname: meta.nickname } : {}),
          },
        });

        if (meta && meta.extras.length > 0) {
          await upsertExtraItemsFromMeta(ticket.id, meta.extras, env, tx);
        } else if (item.quantity === 1 && ticketsMeta.length === 0) {
          await upsertExtraItemsFromOrderItemsForEvent(orderId, item.eventId, ticket.id, env, tx);
        }

        results.push({
          ticketId: ticket.id,
          code: signTicketCode(ticket.id, env),
          userId: order.userId,
          eventId: item.eventId,
          eventTitle: item.event.title,
        });
      }
    }

    // Mixed orders may also carry extras_only cart items: standalone OrderItem(kind='extras')
    // rows for an event with no paired ticket line in this order. Attach those extras to
    // the user's existing valid ticket for that event, mirroring `issueExtrasOnly`.
    const extrasItems = await tx.orderItem.findMany({
      where: { orderId, kind: 'extras' },
      select: { eventId: true, event: { select: { title: true } } },
    });
    const ticketEventIds = new Set(
      ticketItems.map((i) => i.eventId).filter((id): id is string => id !== null),
    );
    const seenExtrasOnlyEvents = new Set<string>();
    for (const ex of extrasItems) {
      if (!ex.eventId || !ex.event) continue;
      if (ticketEventIds.has(ex.eventId)) continue;
      if (seenExtrasOnlyEvents.has(ex.eventId)) continue;
      seenExtrasOnlyEvents.add(ex.eventId);

      await lockTicketTuple(tx, order.userId, ex.eventId);

      const ticket = await tx.ticket.findFirst({
        where: { userId: order.userId, eventId: ex.eventId, status: 'valid' },
      });
      if (!ticket) {
        throw new TicketRevokedForExtrasOnlyError(orderId, order.userId, ex.eventId);
      }

      await upsertExtraItemsFromOrderItemsForEvent(orderId, ex.eventId, ticket.id, env, tx);

      results.push({
        ticketId: ticket.id,
        code: signTicketCode(ticket.id, env),
        userId: order.userId,
        eventId: ex.eventId,
        eventTitle: ex.event.title,
      });
    }

    const garageResult = await fulfillGarageSpotsForOrder(tx, order.id);
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        ...(order.cartId ? {} : { providerRef }),
        ...(garageResult.orderIsAllVirtual ? { fulfillmentStatus: 'virtual_complete' } : {}),
      },
    });

    return results;
  });
};
