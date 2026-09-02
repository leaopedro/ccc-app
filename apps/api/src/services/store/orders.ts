import { prisma } from '@ccc/db';
import {
  type AdminOrderRefundImpact,
  type AdminStoreOrderAuditEntry,
  type AdminStoreOrderDetail,
  type AdminStoreOrderItem,
  type AdminStoreOrderListResponse,
  type AdminStoreOrderQueueFilter,
  type AdminStoreOrderQueueTotals,
  type AdminStoreOrderRow,
  adminAuditActionSchema,
} from '@ccc/shared/admin';
import { type AdminStoreFulfillmentUpdate, type StoreFulfillmentStatus } from '@ccc/shared/store';
import type { OrderKind, Prisma } from '@prisma/client';

import { recordAudit } from '../admin-audit.js';
import { decryptField } from '../crypto/field-encryption.js';
import { resolveOrderExtraItemIds } from '../orders/revoke.js';

const ORDER_KINDS: OrderKind[] = ['product', 'mixed'];

const SHIP_TRANSITIONS: Record<StoreFulfillmentStatus, StoreFulfillmentStatus[]> = {
  unfulfilled: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  pickup_ready: [],
  picked_up: [],
  cancelled: [],
};

const PICKUP_TRANSITIONS: Record<StoreFulfillmentStatus, StoreFulfillmentStatus[]> = {
  unfulfilled: ['pickup_ready', 'cancelled'],
  pickup_ready: ['picked_up', 'cancelled'],
  picked_up: [],
  packed: [],
  shipped: [],
  delivered: [],
  cancelled: [],
};

export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`order ${id} not found`);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderNotEligibleError extends Error {
  constructor(id: string, reason: string) {
    super(`order ${id} not eligible: ${reason}`);
    this.name = 'OrderNotEligibleError';
  }
}

export class FulfillmentTransitionError extends Error {
  constructor(
    public readonly from: StoreFulfillmentStatus,
    public readonly to: StoreFulfillmentStatus,
    public readonly method: 'ship' | 'pickup',
  ) {
    super(`invalid fulfillment transition ${from} → ${to} for ${method}`);
    this.name = 'FulfillmentTransitionError';
  }
}

export const isAllowedFulfillmentTransition = (
  from: StoreFulfillmentStatus,
  to: StoreFulfillmentStatus,
  method: 'ship' | 'pickup',
): boolean => {
  if (from === to) return false;
  const table = method === 'ship' ? SHIP_TRANSITIONS : PICKUP_TRANSITIONS;
  return table[from].includes(to);
};

/**
 * The single definition of "this order belongs to the store fulfilment
 * workflow". Three independent conditions, each excluded for its own reason:
 *
 *  - `kind` product/mixed: matches the list-path filter, so detail and update
 *    reject anything the queue never shows.
 *  - `fulfillmentMethod` ship/pickup: garage-spot purchases carry `virtual`
 *    and are settled by `fulfillGarageSpotsForOrder`. They must never enter a
 *    hand-worked packing queue.
 *  - at least one non-virtual product line: a ticket+garage-spot `mixed` order
 *    inherits `pickup` from its ticket line but has nothing physical to pack.
 *
 * Every caller goes through this: `getAdminOrderDetail`'s
 * `fulfillmentSurface: 'store'` asks the boolean form, and both
 * `getAdminStoreOrderDetail` and `updateAdminStoreFulfillment` throw through
 * `assertStoreFulfillableOrder` below. A `fulfillmentSurface: 'store'` that
 * points at a 404 is therefore not expressible.
 */
type StoreFulfillableInput = {
  kind: OrderKind;
  fulfillmentMethod: 'ship' | 'pickup' | 'virtual';
  items: Array<{ kind: string; variant: { product: { virtual: boolean } } | null }>;
};

/** The failing condition's reason, or null when the order qualifies. */
const storeFulfillableRejection = (order: StoreFulfillableInput): string | null => {
  if (order.kind !== 'product' && order.kind !== 'mixed') {
    return `kind ${order.kind} is not a store order`;
  }
  if (order.fulfillmentMethod !== 'ship' && order.fulfillmentMethod !== 'pickup') {
    return `fulfillmentMethod ${order.fulfillmentMethod} is not a store order`;
  }
  if (!order.items.some((it) => it.kind === 'product' && it.variant?.product.virtual === false)) {
    return 'order has no physical product items';
  }
  return null;
};

export const isStoreFulfillableOrder = (order: StoreFulfillableInput): boolean =>
  storeFulfillableRejection(order) === null;

/**
 * Assertion form, so a caller that passed the gate carries the narrowed
 * `kind` / `fulfillmentMethod` in the type system too. Without this the
 * callers would have to re-state the conditions to satisfy `tsc`, which is
 * exactly the duplication the extraction removes.
 */
export function assertStoreFulfillableOrder<T extends StoreFulfillableInput>(
  orderId: string,
  order: T,
): asserts order is T & { kind: 'product' | 'mixed'; fulfillmentMethod: 'ship' | 'pickup' } {
  const reason = storeFulfillableRejection(order);
  if (reason !== null) throw new OrderNotEligibleError(orderId, reason);
}

/**
 * Blast radius of a full Stripe refund of `order`, read straight off the
 * `charge.refunded` cascade in routes/stripe-webhook.ts:
 *
 *   affectedIds = order.cartId && anchor is paid
 *                   ? every order sharing that cartId (this one included)
 *                   : [order.id]
 *   then revokeTicketsForRefundedOrder(id) for every affected id.
 *
 * Note `revokeTicketsForRefundedOrder` runs on ALL affected ids regardless of
 * their own status, while the status flip only touches rows still `paid`. So
 * the ticket counts here deliberately do not filter on order status either —
 * a `pending` sibling's valid ticket really does get revoked.
 *
 * Tickets are not the whole cascade. `revokeTicketsForRefundedOrder` also
 * revokes `TicketExtraItem` rows (event extras: the camiseta, the pit pass) and
 * `PickupVoucher` rows, and an `extras_only` order owns no `Ticket` at all — so
 * counting tickets alone showed a flat 0 for precisely the order whose refund
 * destroys goods. The extra-item numbers come from `resolveOrderExtraItemIds`,
 * the same resolver the revoke runs on, so the banner cannot promise a
 * different number than the webhook delivers.
 */
export const computeRefundImpact = async (order: {
  id: string;
  cartId: string | null;
}): Promise<AdminOrderRefundImpact> => {
  const siblingOrders = order.cartId
    ? await prisma.order.findMany({
        where: { cartId: order.cartId, id: { not: order.id } },
        select: { id: true },
      })
    : [];
  const siblingOrderIds = siblingOrders.map((o) => o.id);
  const [
    siblingTicketCount,
    ownTicketCount,
    ownExtraItemCount,
    siblingExtraItemCounts,
    ownVoucherCount,
    siblingVoucherCount,
  ] = await Promise.all([
    siblingOrderIds.length
      ? prisma.ticket.count({ where: { orderId: { in: siblingOrderIds }, status: 'valid' } })
      : Promise.resolve(0),
    prisma.ticket.count({ where: { orderId: order.id, status: 'valid' } }),
    countRevocableExtraItems(order.id),
    Promise.all(siblingOrderIds.map((id) => countRevocableExtraItems(id))),
    prisma.pickupVoucher.count({ where: { orderId: order.id, status: 'valid' } }),
    siblingOrderIds.length
      ? prisma.pickupVoucher.count({
          where: { orderId: { in: siblingOrderIds }, status: 'valid' },
        })
      : Promise.resolve(0),
  ]);
  return {
    siblingOrderCount: siblingOrderIds.length,
    siblingTicketCount,
    ownTicketCount,
    ownExtraItemCount,
    siblingExtraItemCount: siblingExtraItemCounts.reduce((sum, n) => sum + n, 0),
    ownVoucherCount,
    siblingVoucherCount,
  };
};

/**
 * Extras the cascade would revoke for one order id.
 *
 * Mirrors `revokeTicketsForRefundedOrder`'s branching exactly, branch for
 * branch, because a count that does not match the revoke is worse than no
 * count. `extras_only` is the resolver alone. Anything else loses the extras
 * hanging off its OWN valid tickets, and a `mixed` order ADDS the resolver on
 * top rather than falling back to it: it can carry a ticket line for event A
 * and a standalone extras line for event B at the same time, and both are
 * revoked. The two halves cannot double-count, because
 * `extrasScopesForOrder` drops every event that has a ticket line in this
 * order, so the resolver never returns an item sitting on a ticket the order
 * owns.
 */
const countRevocableExtraItems = async (orderId: string): Promise<number> => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { kind: true } });
  if (!order) return 0;

  if (order.kind === 'extras_only') {
    return (await resolveOrderExtraItemIds(prisma, orderId)).length;
  }

  const ownTickets = await prisma.ticket.findMany({
    where: { orderId, status: 'valid' },
    select: { id: true },
  });
  const onOwnTickets =
    ownTickets.length > 0
      ? await prisma.ticketExtraItem.count({
          where: { ticketId: { in: ownTickets.map((t) => t.id) }, status: 'valid' },
        })
      : 0;

  if (order.kind !== 'mixed') return onOwnTickets;
  return onOwnTickets + (await resolveOrderExtraItemIds(prisma, orderId)).length;
};

/** Admin audit rows for an order, newest first, with the actor resolved. */
export const loadAdminOrderAuditHistory = async (
  orderId: string,
): Promise<AdminStoreOrderAuditEntry[]> => {
  const audits = await prisma.adminAudit.findMany({
    where: { entityType: 'order', entityId: orderId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const actorIds = Array.from(new Set(audits.map((a) => a.actorId)));
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  return audits
    .map((a) => {
      const action = adminAuditActionSchema.safeParse(a.action);
      if (!action.success) return null;
      const actor = actorById.get(a.actorId) ?? null;
      const metadata =
        a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata)
          ? (a.metadata as Record<string, unknown>)
          : null;
      return {
        id: a.id,
        actorName: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
        action: action.data,
        metadata,
        createdAt: a.createdAt.toISOString(),
      } satisfies AdminStoreOrderAuditEntry;
    })
    .filter((e): e is AdminStoreOrderAuditEntry => e !== null);
};

const FILTER_TO_STATUSES: Record<
  Exclude<AdminStoreOrderQueueFilter, 'all' | 'open'>,
  StoreFulfillmentStatus[]
> = {
  unfulfilled: ['unfulfilled'],
  packed: ['packed'],
  shipped: ['shipped'],
  delivered: ['delivered'],
  pickup_ready: ['pickup_ready'],
  picked_up: ['picked_up'],
  cancelled: ['cancelled'],
};

const TERMINAL_STATUSES: StoreFulfillmentStatus[] = ['delivered', 'picked_up', 'cancelled'];

// Admin store queue invariant: an order belongs to the queue only when it has
// at least one physical (non-virtual) product OrderItem. Virtual-only orders
// (garage spots) settle automatically via fulfillGarageSpotsForOrder and never
// need pack/ship/pickup workflow. A mixed cart that ends up as ticket+virtual
// (no physical product) could otherwise carry fulfillmentMethod='pickup' from
// the ticket line and leak into the queue — filter on item presence, not on
// fulfillmentMethod alone.
const HAS_PHYSICAL_PRODUCT_ITEM: Prisma.OrderWhereInput = {
  items: {
    some: {
      kind: 'product',
      variant: { is: { product: { is: { virtual: false } } } },
    },
  },
};

const trackingFromMetadata = (metadata: Prisma.JsonValue | null): string | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const tracking = (metadata as Record<string, unknown>).trackingCode;
  return typeof tracking === 'string' && tracking.trim() !== '' ? tracking : null;
};

const computeTotals = (
  rows: { fulfillmentStatus: StoreFulfillmentStatus }[],
): AdminStoreOrderQueueTotals => {
  const counts: AdminStoreOrderQueueTotals = {
    all: rows.length,
    open: 0,
    unfulfilled: 0,
    packed: 0,
    shipped: 0,
    delivered: 0,
    pickup_ready: 0,
    picked_up: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    counts[row.fulfillmentStatus] += 1;
    if (!TERMINAL_STATUSES.includes(row.fulfillmentStatus)) counts.open += 1;
  }
  return counts;
};

type ListInput = {
  status?: AdminStoreOrderQueueFilter | undefined;
  kind?: 'all' | 'product' | 'mixed' | undefined;
  q?: string | undefined;
};

export const listAdminStoreOrders = async (
  input: ListInput,
): Promise<AdminStoreOrderListResponse> => {
  const kindFilter: OrderKind[] =
    input.kind === 'product' ? ['product'] : input.kind === 'mixed' ? ['mixed'] : ORDER_KINDS;

  // Exclude virtual-only orders (garage spot purchases) from admin store queue.
  // Virtual orders settle automatically via fulfillGarageSpotsForOrder and
  // never need pack/ship/pickup workflow. Filter on presence of a non-virtual
  // product OrderItem so mixed ticket+virtual carts (which can carry
  // fulfillmentMethod='pickup' from the ticket line) don't leak in.
  const baseWhere: Prisma.OrderWhereInput = {
    kind: { in: kindFilter },
    status: 'paid',
    fulfillmentMethod: { in: ['ship', 'pickup'] },
    ...HAS_PHYSICAL_PRODUCT_ITEM,
  };
  if (input.q) {
    const q = input.q;
    baseWhere.OR = [
      { id: { contains: q } },
      { providerRef: { contains: q, mode: 'insensitive' } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const allOrders = await prisma.order.findMany({
    where: baseWhere,
    select: { fulfillmentStatus: true },
  });
  // TASK-C will fork virtual orders; until then no rows carry virtual_complete, so the cast is safe.
  const totals = computeTotals(allOrders as { fulfillmentStatus: StoreFulfillmentStatus }[]);

  const filter = input.status ?? 'all';
  const filteredWhere: Prisma.OrderWhereInput = { ...baseWhere };
  if (filter === 'open') {
    filteredWhere.fulfillmentStatus = { notIn: TERMINAL_STATUSES };
  } else if (filter !== 'all') {
    filteredWhere.fulfillmentStatus = { in: FILTER_TO_STATUSES[filter] };
  }

  const orders = await prisma.order.findMany({
    where: filteredWhere,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      kind: true,
      status: true,
      fulfillmentStatus: true,
      fulfillmentMethod: true,
      amountCents: true,
      shippingCents: true,
      currency: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      shippingAddressId: true,
      user: { select: { name: true, email: true } },
      _count: { select: { items: true } },
    },
  });

  const orderIds = orders.map((o) => o.id);
  const lastTracking = orderIds.length
    ? await prisma.adminAudit.findMany({
        where: {
          entityType: 'order',
          entityId: { in: orderIds },
          action: 'store.order.fulfillment_update',
        },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, metadata: true, createdAt: true },
      })
    : [];

  const trackingByOrder = new Map<string, string>();
  for (const audit of lastTracking) {
    if (trackingByOrder.has(audit.entityId)) continue;
    const tracking = trackingFromMetadata(audit.metadata);
    if (tracking) trackingByOrder.set(audit.entityId, tracking);
  }

  const items: AdminStoreOrderRow[] = orders.map((o) => ({
    id: o.id,
    shortId: o.id.slice(-8).toUpperCase(),
    kind: o.kind as 'product' | 'mixed',
    paymentStatus: o.status,
    // TASK-C extends the Zod schemas to include virtual_complete / virtual. Until then no rows carry these values.
    fulfillmentStatus: o.fulfillmentStatus as StoreFulfillmentStatus,
    fulfillmentMethod: o.fulfillmentMethod as 'ship' | 'pickup',
    amountCents: o.amountCents,
    shippingCents: o.shippingCents,
    currency: o.currency,
    itemCount: o._count.items,
    customerName: o.user.name,
    customerEmail: o.user.email,
    trackingCode: trackingByOrder.get(o.id) ?? null,
    hasShippingAddress: o.shippingAddressId !== null,
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));

  return { totals, items };
};

const pickupRefsFromNotes = (
  notes: string | null,
  encryptionKey: string,
): { eventId: string | null; ticketId: string | null } => {
  if (!notes) return { eventId: null, ticketId: null };
  const decrypted = decryptField(notes, encryptionKey) ?? notes;
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const eventId = typeof obj.pickupEventId === 'string' ? obj.pickupEventId : null;
      const ticketId = typeof obj.pickupTicketId === 'string' ? obj.pickupTicketId : null;
      return { eventId, ticketId };
    }
  } catch {
    // ignore
  }
  return { eventId: null, ticketId: null };
};

export const getAdminStoreOrderDetail = async (
  orderId: string,
  encryptionKey: string,
): Promise<AdminStoreOrderDetail> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      shippingAddress: true,
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              sku: true,
              attributes: true,
              productId: true,
              product: { select: { title: true, virtual: true } },
            },
          },
          tier: { select: { name: true } },
          extra: { select: { name: true } },
        },
      },
    },
  });
  if (!order) throw new OrderNotFoundError(orderId);
  assertStoreFulfillableOrder(orderId, order);

  const history: AdminStoreOrderAuditEntry[] = await loadAdminOrderAuditHistory(order.id);

  const lastTracking = history.find(
    (h) =>
      h.action === 'store.order.fulfillment_update' &&
      h.metadata &&
      typeof h.metadata.trackingCode === 'string',
  )?.metadata?.trackingCode;
  const trackingCode =
    typeof lastTracking === 'string' && lastTracking.trim() !== '' ? lastTracking : null;

  const items: AdminStoreOrderItem[] = order.items.map((it) => {
    const attrs =
      it.variant && it.variant.attributes && typeof it.variant.attributes === 'object'
        ? Object.fromEntries(
            Object.entries(it.variant.attributes as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : null;
    return {
      id: it.id,
      kind: it.kind,
      variantId: it.variantId,
      productId: it.variant?.productId ?? null,
      productTitle: it.variant?.product.title ?? null,
      variantName: it.variant?.name ?? null,
      variantSku: it.variant?.sku ?? null,
      variantAttributes: attrs,
      tierId: it.tierId,
      tierName: it.tier?.name ?? null,
      extraId: it.extraId,
      extraLabel: it.extra?.name ?? null,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      subtotalCents: it.subtotalCents,
    };
  });

  const pickupRefs = pickupRefsFromNotes(order.notes, encryptionKey);
  const pickupEventId = order.pickupEventId ?? pickupRefs.eventId;
  const pickupTicketId = order.pickupTicketId ?? pickupRefs.ticketId;
  const pickupEvent = pickupEventId
    ? await prisma.event.findUnique({
        where: { id: pickupEventId },
        select: { id: true, title: true },
      })
    : null;

  // Refund blast radius: a full refund at Stripe flips EVERY order sharing
  // this cartId to `refunded` and revokes their tickets (see the
  // `charge.refunded` cascade in stripe-webhook.ts). See computeRefundImpact.
  const refundImpact = await computeRefundImpact(order);

  return {
    id: order.id,
    shortId: order.id.slice(-8).toUpperCase(),
    kind: order.kind,
    paymentStatus: order.status,
    // TASK-C extends the Zod schemas to include virtual_complete / virtual. Until then no rows carry these values.
    fulfillmentStatus: order.fulfillmentStatus as StoreFulfillmentStatus,
    fulfillmentMethod: order.fulfillmentMethod,
    provider: order.provider,
    providerRef: order.providerRef,
    notes: decryptField(order.notes, encryptionKey) ?? order.notes,
    amountCents: order.amountCents,
    shippingCents: order.shippingCents,
    currency: order.currency,
    itemCount: order.items.length,
    customerName: order.user.name,
    customerEmail: order.user.email,
    customer: { id: order.user.id, name: order.user.name, email: order.user.email },
    shippingAddress: order.shippingAddress
      ? {
          recipientName: order.shippingAddress.recipientName,
          line1: order.shippingAddress.line1,
          line2: order.shippingAddress.line2,
          number: order.shippingAddress.number,
          district: order.shippingAddress.district,
          city: order.shippingAddress.city,
          stateCode: order.shippingAddress.stateCode,
          postalCode: order.shippingAddress.postalCode,
          phone: order.shippingAddress.phone,
        }
      : null,
    pickupEventId,
    pickupEventTitle: pickupEvent?.title ?? null,
    pickupTicketId,
    items,
    history,
    trackingCode,
    hasShippingAddress: order.shippingAddressId !== null,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    refundImpact,
  };
};

export type UpdateFulfillmentInput = AdminStoreFulfillmentUpdate & {
  actorId: string;
  orderId: string;
};

export const updateAdminStoreFulfillment = async (
  input: UpdateFulfillmentInput,
  encryptionKey: string,
): Promise<AdminStoreOrderDetail> => {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      kind: true,
      status: true,
      fulfillmentStatus: true,
      fulfillmentMethod: true,
      items: {
        select: {
          kind: true,
          variant: { select: { product: { select: { virtual: true } } } },
        },
      },
    },
  });
  if (!order) throw new OrderNotFoundError(input.orderId);
  // Kind first, then paid, then the rest: the kind message is the one the
  // route maps for a non-store order, and the existing tests read it.
  if (order.kind !== 'product' && order.kind !== 'mixed') {
    throw new OrderNotEligibleError(input.orderId, `kind ${order.kind} is not a store order`);
  }
  if (order.status !== 'paid') {
    throw new OrderNotEligibleError(input.orderId, `payment status ${order.status} is not paid`);
  }
  assertStoreFulfillableOrder(input.orderId, order);
  // TASK-C extends the Zod schemas to include virtual_complete / virtual. Until then no rows carry these values.
  const fromStatus = order.fulfillmentStatus as StoreFulfillmentStatus;
  const fromMethod = order.fulfillmentMethod;
  if (!isAllowedFulfillmentTransition(fromStatus, input.status, fromMethod)) {
    throw new FulfillmentTransitionError(fromStatus, input.status, fromMethod);
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: input.status },
    });

    await recordAudit(
      {
        actorId: input.actorId,
        action: 'store.order.fulfillment_update',
        entityType: 'order',
        entityId: order.id,
        metadata: {
          from: order.fulfillmentStatus,
          to: input.status,
          method: order.fulfillmentMethod,
          trackingCode: input.trackingCode ?? null,
          note: input.note ?? null,
        },
      },
      tx,
    );
  });

  return getAdminStoreOrderDetail(order.id, encryptionKey);
};
