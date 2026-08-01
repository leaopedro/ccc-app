import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';

export const ORDER_EXPIRY_MS = 15 * 60 * 1000;

export type SweepResult = {
  count: number;
  expiredProviderRefs: string[];
};

const assertReservationReleased = async (
  label: 'ticket tier' | 'variant' | 'ticket extra',
  id: string,
  reserved: number,
  runUpdate: () => Promise<{ count: number }>,
): Promise<void> => {
  const result = await runUpdate();
  if (result.count > 0) return;

  throw new Error(
    `Reservation release failed for ${label} ${id}: reserved quantity is below ${reserved}`,
  );
};

/**
 * Releases every stock reservation held by `orderIds`: ticket tiers, product
 * variants, and ticket extras. Cart orders use `OrderItem` rows; legacy
 * `/orders` ticket purchases have no `OrderItem` and carry tier/quantity on
 * the `Order` row itself, so this helper falls back to `Order.tierId` /
 * `Order.quantity` for orders with no items. Handles `ticket`, `product`,
 * `extras_only`, and `mixed` uniformly. Caller is responsible for first
 * flipping the orders to `expired`.
 */
export const releaseAllReservationsForOrders = async (
  tx: Prisma.TransactionClient,
  orderIds: string[],
): Promise<void> => {
  if (orderIds.length === 0) return;

  const items = await tx.orderItem.findMany({
    where: { orderId: { in: orderIds } },
    select: {
      orderId: true,
      kind: true,
      tierId: true,
      variantId: true,
      quantity: true,
      variant: { select: { product: { select: { virtual: true } } } },
    },
  });

  const orderIdsWithItems = new Set(items.map((i) => i.orderId));
  const legacyOrderIds = orderIds.filter((id) => !orderIdsWithItems.has(id));
  const legacyOrders =
    legacyOrderIds.length > 0
      ? await tx.order.findMany({
          where: { id: { in: legacyOrderIds } },
          select: { kind: true, tierId: true, quantity: true },
        })
      : [];

  const tierReleases = new Map<string, number>();
  const variantReleases = new Map<string, number>();

  for (const it of items) {
    if (it.kind === 'ticket' && it.tierId) {
      tierReleases.set(it.tierId, (tierReleases.get(it.tierId) ?? 0) + it.quantity);
    } else if (it.kind === 'product' && it.variantId) {
      // Virtual products (e.g. garage spot) never reserve Variant.quantitySold
      // at checkout, so there is nothing to decrement. assertReservationReleased
      // would otherwise throw "Reservation release failed" on legitimately
      // pending virtual/mixed orders that have expired.
      if (it.variant?.product?.virtual === true) continue;
      variantReleases.set(it.variantId, (variantReleases.get(it.variantId) ?? 0) + it.quantity);
    }
  }
  // Legacy /orders ticket purchases: no OrderItem, reservation tracked on Order columns.
  // extras_only does not reserve tier stock; product orders predate the Order.variantId
  // column and are not represented here.
  for (const lo of legacyOrders) {
    if (lo.kind === 'ticket' && lo.tierId) {
      tierReleases.set(lo.tierId, (tierReleases.get(lo.tierId) ?? 0) + lo.quantity);
    }
  }

  for (const [tierId, qty] of tierReleases) {
    await assertReservationReleased('ticket tier', tierId, qty, () =>
      tx.ticketTier.updateMany({
        where: { id: tierId, quantitySold: { gte: qty } },
        data: { quantitySold: { decrement: qty } },
      }),
    );
  }
  for (const [variantId, qty] of variantReleases) {
    await assertReservationReleased('variant', variantId, qty, () =>
      tx.variant.updateMany({
        where: { id: variantId, quantitySold: { gte: qty } },
        data: { quantitySold: { decrement: qty } },
      }),
    );
  }

  const orderExtras = await tx.orderExtra.findMany({
    where: { orderId: { in: orderIds } },
    select: { extraId: true, quantity: true },
  });
  const extraReleases = new Map<string, number>();
  for (const { extraId, quantity } of orderExtras) {
    extraReleases.set(extraId, (extraReleases.get(extraId) ?? 0) + quantity);
  }
  for (const [extraId, count] of extraReleases) {
    await assertReservationReleased('ticket extra', extraId, count, () =>
      tx.ticketExtra.updateMany({
        where: { id: extraId, quantitySold: { gte: count } },
        data: { quantitySold: { decrement: count } },
      }),
    );
  }
};

/**
 * Within an existing transaction, expire all pending orders that hold a
 * `ticket`-kind `OrderItem` for `tierId` and whose `expiresAt` has passed.
 * Releases every reservation held by those orders (ticket tier, variant,
 * extras), so mixed orders that pinned multiple kinds are fully unwound.
 * Returns provider refs so the caller can cancel the Stripe PIs after the tx.
 */
export const sweepExpiredOrdersForTier = async (
  tierId: string,
  tx: Prisma.TransactionClient,
): Promise<SweepResult> => {
  const now = new Date();
  const expired = await tx.order.findMany({
    where: {
      status: 'pending',
      expiresAt: { not: null, lt: now },
      // Match cart-grouped orders via OrderItem and legacy /orders tickets via Order.tierId.
      OR: [{ tierId }, { items: { some: { kind: 'ticket', tierId } } }],
    },
    select: { id: true, providerRef: true },
  });

  if (expired.length === 0) return { count: 0, expiredProviderRefs: [] };

  const expiredIds = expired.map((o) => o.id);

  await tx.order.updateMany({
    where: { id: { in: expiredIds } },
    data: { status: 'expired' },
  });

  await releaseAllReservationsForOrders(tx, expiredIds);

  Sentry.addBreadcrumb({
    category: 'orders.sweep',
    message: `Swept ${expired.length} expired pending order(s) for tier ${tierId}`,
    level: 'info',
    data: { tierId, count: expired.length },
  });

  return {
    count: expired.length,
    expiredProviderRefs: expired.flatMap((o) => (o.providerRef ? [o.providerRef] : [])),
  };
};

/**
 * Within an existing transaction, expire all pending orders that hold a
 * `product`-kind `OrderItem` for `variantId` and whose `expiresAt` has passed.
 * Releases every reservation held by those orders (variant, ticket tier,
 * extras), so mixed orders that pinned multiple kinds are fully unwound.
 */
export const sweepExpiredOrdersForVariant = async (
  variantId: string,
  tx: Prisma.TransactionClient,
): Promise<SweepResult> => {
  const now = new Date();
  const expired = await tx.order.findMany({
    where: {
      status: 'pending',
      expiresAt: { not: null, lt: now },
      items: { some: { kind: 'product', variantId } },
    },
    select: { id: true, providerRef: true },
  });

  if (expired.length === 0) return { count: 0, expiredProviderRefs: [] };

  const expiredIds = expired.map((o) => o.id);
  await tx.order.updateMany({
    where: { id: { in: expiredIds } },
    data: { status: 'expired' },
  });

  await releaseAllReservationsForOrders(tx, expiredIds);

  Sentry.addBreadcrumb({
    category: 'orders.sweep',
    message: `Swept ${expired.length} expired pending product order(s) for variant ${variantId}`,
    level: 'info',
    data: { variantId, count: expired.length },
  });

  return {
    count: expired.length,
    expiredProviderRefs: expired.flatMap((o) => (o.providerRef ? [o.providerRef] : [])),
  };
};

export type ExpireSingleOrderOutcome =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | {
      kind: 'ok';
      wasExpired: boolean;
      order: {
        id: string;
        userId: string;
        tierId: string | null;
        kind: string;
        status: string;
        expiresAt: Date | null;
        amountCents: number;
        baseAmountCents: number;
        devFeePercent: number;
        devFeeAmountCents: number;
        currency: string;
        provider: 'stripe' | 'abacatepay';
        providerRef: string | null;
        brCode: string | null;
      };
    };

/**
 * Atomically expire a single pending order if its TTL has passed, releasing
 * every reservation it holds (ticket tier, variant, extras) regardless of
 * `Order.kind` — mixed orders are unwound the same way as ticket/product
 * orders. Returns a discriminated outcome so the caller can split 404
 * (missing) from 403 (non-owner).
 */
export const expireSingleOrder = async (
  orderId: string,
  ownerId: string,
): Promise<ExpireSingleOrderOutcome> => {
  return prisma.$transaction((tx) => expireSingleOrderInTransaction(tx, orderId, ownerId));
};

export const expireSingleOrderInTransaction = async (
  tx: Prisma.TransactionClient,
  orderId: string,
  ownerId: string,
): Promise<ExpireSingleOrderOutcome> => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      tierId: true,
      kind: true,
      status: true,
      expiresAt: true,
      amountCents: true,
      baseAmountCents: true,
      devFeePercent: true,
      devFeeAmountCents: true,
      currency: true,
      provider: true,
      providerRef: true,
      brCode: true,
    },
  });
  if (!order) return { kind: 'not_found' };
  if (order.userId !== ownerId) return { kind: 'forbidden' };

  const isStale =
    order.status === 'pending' && order.expiresAt !== null && order.expiresAt < new Date();

  if (!isStale) return { kind: 'ok', wasExpired: false, order };

  const expiredUpdate = await tx.order.updateMany({
    where: { id: orderId, status: 'pending' },
    data: { status: 'expired' },
  });

  if (expiredUpdate.count === 0) {
    const currentOrder = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        tierId: true,
        kind: true,
        status: true,
        expiresAt: true,
        amountCents: true,
        baseAmountCents: true,
        devFeePercent: true,
        devFeeAmountCents: true,
        currency: true,
        provider: true,
        providerRef: true,
        brCode: true,
      },
    });

    if (!currentOrder) return { kind: 'not_found' };
    if (currentOrder.userId !== ownerId) return { kind: 'forbidden' };

    return { kind: 'ok', wasExpired: false, order: currentOrder };
  }

  await releaseAllReservationsForOrders(tx, [orderId]);

  return { kind: 'ok', wasExpired: true, order: { ...order, status: 'expired' } };
};
