import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';

import { signQrCode, verifyQrCode } from '../../lib/qr.js';

type Tx = Prisma.TransactionClient;

type VoucherEnv = { readonly TICKET_CODE_SECRET: string };

export class InvalidVoucherCodeError extends Error {
  readonly code = 'INVALID_VOUCHER_CODE';
  constructor(message = 'invalid voucher code') {
    super(message);
  }
}
export class VoucherNotFoundError extends Error {
  readonly code = 'VOUCHER_NOT_FOUND';
  constructor(message = 'pickup voucher not found') {
    super(message);
  }
}
export class VoucherWrongEventError extends Error {
  readonly code = 'VOUCHER_WRONG_EVENT';
  constructor(message = 'voucher belongs to a different event') {
    super(message);
  }
}
export class VoucherRevokedError extends Error {
  readonly code = 'VOUCHER_REVOKED';
  constructor(message = 'voucher revoked') {
    super(message);
  }
}

// Deterministic seed keyed by (orderItemId, unitIndex). Concurrent retries
// produce identical codes, so the `code` unique constraint plus the
// `(orderItemId, unitIndex)` unique constraint together collapse races: at
// most one row per unit can ever exist regardless of how many handlers run
// in parallel.
const buildCodeSeed = (orderItemId: string, unitIndex: number): string =>
  `${orderItemId}-${unitIndex}`;

export type MintedVoucher = {
  id: string;
  orderItemId: string;
  variantId: string | null;
  ticketId: string;
  eventId: string;
  code: string;
  status: 'valid' | 'used' | 'revoked';
};

// Mint one PickupVoucher row per product unit (quantity) bound to the given
// pickup ticket. Race-safe via deterministic per-unit codes plus a compound
// unique on (orderItemId, unitIndex) and a single createMany with
// skipDuplicates: Postgres ON CONFLICT DO NOTHING collapses concurrent
// settlement handlers so the order can never over-mint beyond quantity.
export const mintPickupVouchersForOrderTx = async (
  orderId: string,
  ticketId: string,
  eventId: string,
  tx: Tx,
  env: VoucherEnv,
): Promise<MintedVoucher[]> => {
  const productItems = await tx.orderItem.findMany({
    where: { orderId, kind: 'product' },
    select: {
      id: true,
      variantId: true,
      quantity: true,
    },
  });

  if (productItems.length === 0) return [];

  const rows = productItems.flatMap((item) =>
    Array.from({ length: item.quantity }, (_, unitIndex) => ({
      orderId,
      orderItemId: item.id,
      unitIndex,
      ticketId,
      eventId,
      variantId: item.variantId,
      code: signQrCode('v', buildCodeSeed(item.id, unitIndex), env),
      status: 'valid' as const,
    })),
  );

  await tx.pickupVoucher.createMany({ data: rows, skipDuplicates: true });

  return tx.pickupVoucher.findMany({
    where: { orderId },
    select: {
      id: true,
      orderItemId: true,
      variantId: true,
      ticketId: true,
      eventId: true,
      code: true,
      status: true,
    },
  });
};

export type VoucherClaimedItem = {
  id: string;
  orderId: string;
  orderItemId: string;
  ticketId: string;
  eventId: string;
  status: 'valid' | 'used' | 'revoked';
  usedAt: Date | null;
  product: {
    title: string | null;
    variantName: string | null;
    variantSku: string | null;
    variantAttributes: Record<string, string> | null;
  };
  holder: { id: string; name: string };
  ticket: { id: string; tier: { id: string; name: string } };
};

export type VoucherClaimOutcome =
  | { kind: 'claimed'; item: VoucherClaimedItem; claimedAt: Date }
  | { kind: 'already_used'; item: VoucherClaimedItem; originalUsedAt: Date };

const mapAttributes = (raw: unknown): Record<string, string> | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
};

const voucherInclude = {
  orderItem: {
    select: {
      variant: {
        select: {
          name: true,
          sku: true,
          attributes: true,
          product: { select: { title: true } },
        },
      },
    },
  },
  ticket: {
    select: {
      id: true,
      user: { select: { id: true, name: true } },
      tier: { select: { id: true, name: true } },
    },
  },
} as const;

type VoucherWithIncludes = Prisma.PickupVoucherGetPayload<{ include: typeof voucherInclude }>;

const toClaimedItem = (
  v: VoucherWithIncludes,
  status: 'valid' | 'used' | 'revoked',
  usedAt: Date | null,
): VoucherClaimedItem => ({
  id: v.id,
  orderId: v.orderId,
  orderItemId: v.orderItemId,
  ticketId: v.ticketId,
  eventId: v.eventId,
  status,
  usedAt,
  product: {
    title: v.orderItem.variant?.product.title ?? null,
    variantName: v.orderItem.variant?.name ?? null,
    variantSku: v.orderItem.variant?.sku ?? null,
    variantAttributes: mapAttributes(v.orderItem.variant?.attributes),
  },
  holder: v.ticket.user,
  ticket: { id: v.ticket.id, tier: v.ticket.tier },
});

export const claimPickupVoucher = async (
  input: { code: string; eventId: string; actorUserId: string },
  env: VoucherEnv,
): Promise<VoucherClaimOutcome> => {
  try {
    const { kind } = verifyQrCode(input.code, env);
    if (kind !== 'v') throw new InvalidVoucherCodeError('code is not a pickup voucher QR');
  } catch (err) {
    if (err instanceof InvalidVoucherCodeError) throw err;
    throw new InvalidVoucherCodeError();
  }

  const voucher = await prisma.pickupVoucher.findUnique({
    where: { code: input.code },
    include: voucherInclude,
  });
  if (!voucher) throw new VoucherNotFoundError();
  if (voucher.eventId !== input.eventId) throw new VoucherWrongEventError();
  if (voucher.status === 'revoked') throw new VoucherRevokedError();

  if (voucher.status === 'used') {
    return {
      kind: 'already_used',
      item: toClaimedItem(voucher, voucher.status, voucher.usedAt),
      originalUsedAt: voucher.usedAt ?? new Date(),
    };
  }

  const now = new Date();
  const result = await prisma.pickupVoucher.updateMany({
    where: { id: voucher.id, status: 'valid' },
    data: { status: 'used', usedAt: now, usedByUserId: input.actorUserId },
  });

  if (result.count === 1) {
    return {
      kind: 'claimed',
      item: toClaimedItem(voucher, 'used', now),
      claimedAt: now,
    };
  }

  const refreshed = await prisma.pickupVoucher.findUniqueOrThrow({
    where: { id: voucher.id },
  });
  return {
    kind: 'already_used',
    item: toClaimedItem(voucher, refreshed.status, refreshed.usedAt),
    originalUsedAt: refreshed.usedAt ?? now,
  };
};
