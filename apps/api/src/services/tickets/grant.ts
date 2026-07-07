import { prisma } from '@jdm/db';
import { Prisma } from '@prisma/client';

import { signQrCode } from '../../lib/qr.js';

import { signTicketCode } from './codes.js';
import { lockTicketTuple } from './locks.js';

type GrantEnv = { readonly TICKET_CODE_SECRET: string };

export type GrantInput = {
  actorId: string;
  userId: string;
  eventId: string;
  tierId: string;
  extras?: string[];
  carId?: string;
  licensePlate?: string;
  nickname?: string;
  note?: string;
};

export type GrantResult = {
  ticketId: string;
  code: string;
  extraItems: { extraId: string; code: string }[];
};

export class DuplicateTicketError extends Error {
  readonly code = 'DUPLICATE_TICKET' as const;
  constructor(
    public readonly userId: string,
    public readonly eventId: string,
    public readonly maxTicketsPerUser: number | null,
    public readonly existingValidCount: number,
  ) {
    super(
      `user ${userId} reached ticket limit (${existingValidCount}/${maxTicketsPerUser ?? '∞'}) for event ${eventId}`,
    );
    this.name = 'DuplicateTicketError';
  }
}

export class GrantInputError extends Error {
  readonly code = 'GRANT_INPUT_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'GrantInputError';
  }
}

export const grantCompTicket = async (input: GrantInput, env: GrantEnv): Promise<GrantResult> => {
  const {
    actorId,
    userId,
    eventId,
    tierId,
    extras = [],
    carId,
    licensePlate,
    nickname,
    note,
  } = input;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new GrantInputError(`user ${userId} not found`);

    const tier = await tx.ticketTier.findFirst({
      where: { id: tierId, eventId },
      select: { id: true, event: { select: { maxTicketsPerUser: true } } },
    });
    if (!tier) throw new GrantInputError(`tier ${tierId} not found for event ${eventId}`);

    for (const extraId of extras) {
      const extra = await tx.ticketExtra.findFirst({
        where: { id: extraId, eventId },
        select: { id: true },
      });
      if (!extra) throw new GrantInputError(`extra ${extraId} not found for event ${eventId}`);
    }

    await lockTicketTuple(tx, userId, eventId);

    const existingValidCount = await tx.ticket.count({
      where: { userId, eventId, status: 'valid' },
    });
    const maxTicketsPerUser = tier.event.maxTicketsPerUser;
    if (maxTicketsPerUser !== null && existingValidCount >= maxTicketsPerUser) {
      throw new DuplicateTicketError(userId, eventId, maxTicketsPerUser, existingValidCount);
    }

    const order = await tx.order.create({
      data: {
        userId,
        eventId,
        tierId,
        amountCents: 0,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: null,
        status: 'paid',
        paidAt: new Date(),
      },
    });

    // Comp grants are uncapped but quantitySold must reflect reality for dashboards.
    await tx.ticketTier.update({
      where: { id: tierId },
      data: { quantitySold: { increment: 1 } },
    });

    let ticket;
    try {
      ticket = await tx.ticket.create({
        data: {
          orderId: order.id,
          userId,
          eventId,
          tierId,
          ...(carId && { carId }),
          ...(licensePlate && { licensePlate }),
          ...(nickname && { nickname }),
          source: 'comp',
          status: 'valid',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DuplicateTicketError(userId, eventId, maxTicketsPerUser, existingValidCount);
      }
      throw err;
    }

    const extraResults: { extraId: string; code: string }[] = [];
    for (const extraId of extras) {
      const item = await tx.ticketExtraItem.create({
        data: {
          ticketId: ticket.id,
          extraId,
          code: signQrCode('e', `${ticket.id}-${extraId}`, env),
          status: 'valid',
        },
      });
      extraResults.push({ extraId, code: item.code });
    }

    const metadata: Record<string, unknown> = { eventId, userId };
    if (carId) metadata['carId'] = carId;
    if (licensePlate) metadata['licensePlate'] = licensePlate;
    if (nickname) metadata['nickname'] = nickname;
    if (note) metadata['note'] = note;

    await tx.adminAudit.create({
      data: {
        actorId,
        action: 'ticket.grant_comp',
        entityType: 'ticket',
        entityId: ticket.id,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    return {
      ticketId: ticket.id,
      code: signTicketCode(ticket.id, env),
      extraItems: extraResults,
    };
  });
};
