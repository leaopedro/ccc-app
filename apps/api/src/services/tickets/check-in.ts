import { prisma } from '@ccc/db';
import type { Car, Garage, Ticket, TicketTier, User } from '@prisma/client';

import { awardBadge } from '../garage/awarder.js';
import { checkEligibility as checkEventEligibility } from '../garage/eligibility/events.js';
import { awardXp } from '../garage/xp-awarder.js';

import { verifyTicketCode } from './codes.js';

export class InvalidTicketCodeError extends Error {
  readonly code = 'INVALID_TICKET_CODE';
  constructor(message = 'invalid ticket code') {
    super(message);
  }
}
export class TicketNotFoundError extends Error {
  readonly code = 'TICKET_NOT_FOUND';
  constructor(message = 'ticket not found') {
    super(message);
  }
}
export class TicketWrongEventError extends Error {
  readonly code = 'TICKET_WRONG_EVENT';
  constructor(
    readonly expectedEventId: string,
    readonly actualEventId: string,
  ) {
    super('ticket is for a different event');
  }
}
export class TicketRevokedError extends Error {
  readonly code = 'TICKET_REVOKED';
  constructor(message = 'ticket revoked') {
    super(message);
  }
}

// Garage shape needed to compute isPremiumActive on the scanner payload.
// Pulled via the ticket holder (`user.garage`) since the badge is per-user,
// not per-car (the car is just rendered next to the holder identity).
type GaragePremium = Pick<Garage, 'premiumTier' | 'premiumUntil'>;

type TicketWithRelations = Ticket & {
  tier: TicketTier;
  user: User & { garage: GaragePremium | null };
  car: Car | null;
};

export type CheckInOutcome =
  | { kind: 'admitted'; ticket: TicketWithRelations; checkedInAt: Date }
  | { kind: 'already_used'; ticket: TicketWithRelations; originalUsedAt: Date };

type CheckInEnv = { readonly TICKET_CODE_SECRET: string };

const ticketInclude = {
  tier: true,
  user: { include: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
  car: true,
} as const;

export const checkInTicket = async (
  input: { code: string; eventId: string },
  env: CheckInEnv,
): Promise<CheckInOutcome> => {
  let ticketId: string;
  try {
    ticketId = verifyTicketCode(input.code, env);
  } catch {
    throw new InvalidTicketCodeError();
  }

  const now = new Date();

  // Wrap the status flip + Conquistas awarding in one tx so the event-surface
  // badge grants are atomic with the check-in. A crash between the update
  // and the award would otherwise leave the ticket `used` with no badge,
  // and EVT-001/EVT-003/EVT-002 are count-based — replays would re-award
  // them on the next check-in only because of the unique constraint guard.
  const flipped = await prisma.$transaction(async (tx) => {
    const result = await tx.ticket.updateMany({
      where: { id: ticketId, eventId: input.eventId, status: 'valid' },
      data: { status: 'used', usedAt: now },
    });
    if (result.count !== 1) return false;

    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { userId: true },
    });
    const garage = await tx.garage.findUnique({
      where: { userId: ticket.userId },
      select: { id: true },
    });
    if (garage) {
      const codes = await checkEventEligibility(tx, ticket.userId, ticketId);
      for (const code of codes) {
        try {
          await awardBadge(tx, garage.id, code, `check_in:${ticketId}`);
        } catch {
          // Swallow — badge grant must never block a check-in. The
          // staffer is mid-scan; surfacing a 500 here would block the
          // line. Failure mode is observable via missing audit rows.
        }
      }

      // XP: +10 for the event_checkin reason. Idempotency triple
      // `(garageId, 'event_checkin', 'event:<eventId>')` is DB-enforced via
      // @@unique on XpEvent (§C1). Per canon §5 the awarder silently no-ops
      // on killswitch off + P2002 duplicates and RETHROWS any other error
      // — we deliberately do NOT wrap this call in try/catch so the parent
      // tx rolls back atomically with the ticket flip (same-tx contract
      // from §288). This is the inverse of the badge swallow above:
      // badges fail open, XP fails closed.
      await awardXp(tx, garage.id, 'event_checkin', {
        sourceRef: `event:${input.eventId}`,
      });
    }
    return true;
  });

  if (flipped) {
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: ticketInclude,
    });
    return { kind: 'admitted', ticket, checkedInAt: now };
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: ticketInclude,
  });
  if (!ticket) throw new TicketNotFoundError();
  if (ticket.eventId !== input.eventId) {
    throw new TicketWrongEventError(input.eventId, ticket.eventId);
  }
  if (ticket.status === 'revoked') throw new TicketRevokedError();
  // ticket.status === 'used' — idempotent replay
  return {
    kind: 'already_used',
    ticket,
    originalUsedAt: ticket.usedAt ?? now,
  };
};
