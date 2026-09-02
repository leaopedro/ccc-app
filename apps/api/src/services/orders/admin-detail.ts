/**
 * Kind-agnostic admin order detail: the read behind the refund surface.
 *
 * Why this exists at all. `POST /admin/orders/:id/refund` accepts any order
 * kind, but the only admin screen that could reach it was
 * /loja/pedidos/[id], and `getAdminStoreOrderDetail` 404s anything that is not
 * a physical store order. `OrderKind` has five values and `Order.kind`
 * DEFAULTS to `ticket`, so the club's core product — an event ticket — had no
 * detail page and therefore no refund button, which is exactly the Stripe
 * dashboard trip the refund feature was built to remove.
 *
 * Why not just widen the store detail. Its shape carries `fulfillmentStatus`,
 * `fulfillmentMethod`, `shippingAddress` and pickup refs. `fulfillmentMethod`
 * defaults to `pickup` and `fulfillmentStatus` to `unfulfilled`, so a widened
 * store detail would hand the screen a convincing "Retirada / Não cumprido"
 * pair for every ticket order and invite an operator into a workflow that
 * does not exist for it. This shape simply has no such fields; the fulfilment
 * workflow stays behind `PATCH /admin/store/orders/:id/fulfillment` and its
 * own untouched kind / method / physical-item gate.
 */
import { prisma } from '@ccc/db';
import type {
  AdminOrderDetail,
  AdminOrderFulfillmentSurface,
  AdminOrderLine,
} from '@ccc/shared/admin';

import {
  computeRefundImpact,
  isStoreFulfillableOrder,
  loadAdminOrderAuditHistory,
} from '../store/orders.js';

export class AdminOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`order ${id} not found`);
    this.name = 'AdminOrderNotFoundError';
  }
}

type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

const loadOrder = (orderId: string) =>
  prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      event: { select: { id: true, title: true } },
      tier: { select: { name: true } },
      box: { select: { cycleKey: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          variant: {
            select: {
              name: true,
              sku: true,
              product: { select: { title: true, virtual: true } },
            },
          },
          tier: { select: { name: true } },
          extra: { select: { name: true } },
        },
      },
      orderExtras: {
        orderBy: { createdAt: 'asc' },
        include: { extra: { select: { name: true } } },
      },
    },
  });

/**
 * `OrderItem` rows when the order has them, otherwise the legacy shape.
 *
 * Load-bearing: the commonest ticket order in this codebase has NO OrderItem
 * rows at all. `POST /orders` writes `eventId` / `tierId` / `quantity` plus
 * `OrderExtra` rows directly (routes/orders.ts, createPendingOrder), and only
 * cart checkout writes OrderItems. Reading items alone would render the most
 * frequent refund case as an empty table.
 *
 * Prices stay null on the legacy path rather than being back-computed from
 * `Order.amountCents`: that figure already includes the dev fee and shipping,
 * so any per-line split would be a guess shown as a currency.
 */
const buildLines = (order: LoadedOrder): AdminOrderLine[] => {
  if (order.items.length > 0) {
    return order.items.map((it) => {
      const label =
        it.kind === 'product'
          ? (it.variant?.product.title ?? 'Produto')
          : it.kind === 'ticket'
            ? `Ingresso · ${it.tier?.name ?? '—'}`
            : `Extra · ${it.extra?.name ?? '—'}`;
      const sublabel =
        it.kind === 'product'
          ? [it.variant?.name, it.variant?.sku ? `SKU ${it.variant.sku}` : null]
              .filter((part): part is string => typeof part === 'string' && part !== '')
              .join(' · ') || null
          : (order.event?.title ?? null);
      return {
        id: it.id,
        kind: it.kind,
        label,
        sublabel,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        subtotalCents: it.subtotalCents,
      } satisfies AdminOrderLine;
    });
  }

  const lines: AdminOrderLine[] = [];
  if (order.kind !== 'extras_only' && order.tier && order.quantity > 0) {
    lines.push({
      id: `${order.id}:ticket`,
      kind: 'ticket',
      label: `Ingresso · ${order.tier.name}`,
      sublabel: order.event?.title ?? null,
      quantity: order.quantity,
      unitPriceCents: null,
      subtotalCents: null,
    });
  }
  for (const oe of order.orderExtras) {
    lines.push({
      id: oe.id,
      kind: 'extras',
      label: `Extra · ${oe.extra.name}`,
      sublabel: order.event?.title ?? null,
      quantity: oe.quantity,
      unitPriceCents: null,
      subtotalCents: null,
    });
  }
  if (lines.length === 0 && order.box) {
    lines.push({
      id: `${order.id}:box`,
      kind: 'product',
      label: `Box mensal · ${order.box.cycleKey}`,
      sublabel: null,
      quantity: 1,
      unitPriceCents: null,
      subtotalCents: null,
    });
  }
  return lines;
};

const fulfillmentSurfaceOf = (order: LoadedOrder): AdminOrderFulfillmentSurface => {
  if (order.kind === 'box') return 'box';
  return isStoreFulfillableOrder(order) ? 'store' : 'none';
};

export const getAdminOrderDetail = async (orderId: string): Promise<AdminOrderDetail> => {
  const order = await loadOrder(orderId);
  if (!order) throw new AdminOrderNotFoundError(orderId);

  const [history, refundImpact] = await Promise.all([
    loadAdminOrderAuditHistory(order.id),
    computeRefundImpact(order),
  ]);

  return {
    id: order.id,
    shortId: order.id.slice(-8).toUpperCase(),
    kind: order.kind,
    paymentStatus: order.status,
    provider: order.provider,
    providerRef: order.providerRef,
    amountCents: order.amountCents,
    shippingCents: order.shippingCents,
    currency: order.currency,
    customer: { id: order.user.id, name: order.user.name, email: order.user.email },
    eventId: order.event?.id ?? null,
    eventTitle: order.event?.title ?? null,
    lines: buildLines(order),
    history,
    refundImpact,
    fulfillmentSurface: fulfillmentSurfaceOf(order),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
  };
};
