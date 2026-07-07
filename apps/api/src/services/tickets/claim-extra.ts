import { prisma } from '@jdm/db';

import { verifyQrCode } from '../../lib/qr.js';

export class InvalidExtraCodeError extends Error {
  readonly code = 'INVALID_EXTRA_CODE';
  constructor(message = 'invalid extra code') {
    super(message);
  }
}
export class ExtraItemNotFoundError extends Error {
  readonly code = 'EXTRA_ITEM_NOT_FOUND';
  constructor(message = 'extra item not found') {
    super(message);
  }
}
export class ExtraWrongEventError extends Error {
  readonly code = 'EXTRA_WRONG_EVENT';
  constructor(message = 'extra belongs to a different event') {
    super(message);
  }
}
export class ExtraItemRevokedError extends Error {
  readonly code = 'EXTRA_ITEM_REVOKED';
  constructor(message = 'extra item revoked') {
    super(message);
  }
}

type ClaimExtraEnv = { readonly TICKET_CODE_SECRET: string };

export type ClaimExtraOutcome =
  | { kind: 'claimed'; item: ClaimedItem; claimedAt: Date }
  | { kind: 'already_used'; item: ClaimedItem; originalUsedAt: Date };

type ClaimedItem = {
  id: string;
  extraId: string;
  extraName: string;
  status: string;
  usedAt: Date | null;
  ticket: { id: string; user: { id: string; name: string }; tier: { id: string; name: string } };
};

const itemInclude = {
  extra: { select: { id: true, name: true, eventId: true } },
  ticket: {
    select: {
      id: true,
      eventId: true,
      user: { select: { id: true, name: true } },
      tier: { select: { id: true, name: true } },
    },
  },
} as const;

export const claimExtra = async (
  input: { code: string; eventId: string },
  env: ClaimExtraEnv,
): Promise<ClaimExtraOutcome> => {
  try {
    const { kind } = verifyQrCode(input.code, env);
    if (kind !== 'e') throw new InvalidExtraCodeError('code is not an extra QR');
  } catch (err) {
    if (err instanceof InvalidExtraCodeError) throw err;
    throw new InvalidExtraCodeError();
  }

  const item = await prisma.ticketExtraItem.findUnique({
    where: { code: input.code },
    include: itemInclude,
  });
  if (!item) throw new ExtraItemNotFoundError();
  if (item.extra.eventId !== input.eventId) throw new ExtraWrongEventError();
  if (item.status === 'revoked') throw new ExtraItemRevokedError();

  if (item.status === 'used') {
    return {
      kind: 'already_used',
      item: {
        id: item.id,
        extraId: item.extraId,
        extraName: item.extra.name,
        status: item.status,
        usedAt: item.usedAt,
        ticket: item.ticket,
      },
      originalUsedAt: item.usedAt ?? new Date(),
    };
  }

  // Atomic claim: only one concurrent caller gets count=1
  const now = new Date();
  const result = await prisma.ticketExtraItem.updateMany({
    where: { id: item.id, status: 'valid' },
    data: { status: 'used', usedAt: now },
  });

  if (result.count === 1) {
    return {
      kind: 'claimed',
      item: {
        id: item.id,
        extraId: item.extraId,
        extraName: item.extra.name,
        status: 'used',
        usedAt: now,
        ticket: item.ticket,
      },
      claimedAt: now,
    };
  }

  // Lost the race — another caller claimed it between our read and update
  const refreshed = await prisma.ticketExtraItem.findUniqueOrThrow({
    where: { id: item.id },
  });
  return {
    kind: 'already_used',
    item: {
      id: item.id,
      extraId: item.extraId,
      extraName: item.extra.name,
      status: refreshed.status,
      usedAt: refreshed.usedAt,
      ticket: item.ticket,
    },
    originalUsedAt: refreshed.usedAt ?? now,
  };
};
