/**
 * The one cart settlement path for AbacatePay.
 *
 * Why it exists (fix round 2, IMPORTANT). A Pix cart checkout produces N
 * Orders plus one Cart row, and settling it is NOT just "call settlePaidOrder
 * per order": the Cart itself has to move to `converted`. Miss that single
 * write and the customer is stranded, silently and permanently:
 *
 *   - reserveAndCreateOrders (services/cart/checkout.ts) leaves the cart at
 *     `checking_out`.
 *   - getOrCreateCart / loadCartForCheckout keep handing that same
 *     `checking_out` cart back, still holding the already-paid items.
 *   - the next checkout's guard is `updateMany({ where: { status: 'open' } })`
 *     and throws CART_ALREADY_CHECKING_OUT.
 *
 * So the customer pays, gets their tickets, and can never check out again.
 * routes/abacatepay-webhook.ts always did the `converted` write;
 * workers/pix-reconcile.ts called the same `settlePaidOrder` but not the same
 * PATH, and so recovered a payment straight into that dead end. Rather than
 * copy the missing line into the worker, both callers now go through here.
 *
 * What stays with the callers: webhook-only concerns (signature, replay
 * window, markProcessed dedup, orphan-billing and partial-mismatch detection
 * against `metadata.orderIds`) and the push, which the callers send with the
 * same payload.
 */
import { prisma } from '@ccc/db';
import type { OrderKind } from '@prisma/client';

import { EventPickupAssignmentUnavailableError } from '../store/event-pickup.js';
import {
  OrderNotPendingError,
  TicketAlreadyExistsForEventError,
  TicketRevokedForExtrasOnlyError,
} from '../tickets/issue.js';

import { flagManualRefund } from './manual-refund-flag.js';
import { settlePaidOrder } from './settle.js';

type IssueEnv = { readonly TICKET_CODE_SECRET: string };

export type CartOrderRow = {
  id: string;
  userId: string;
  eventId: string | null;
  amountCents: number;
  kind: OrderKind;
};

export type CartSettlementResult = {
  /** Rows that were still `pending` when this ran, in settlement order. */
  orders: CartOrderRow[];
  /** True when at least one ticket was actually issued — gates the push. */
  issuedAnyTicket: boolean;
  /** Owner of the cart's oldest order; null when nothing was pending. */
  userId: string | null;
};

/**
 * Tickets settle first, then extras-only, then everything else. A ticket order
 * that fails on the duplicate-ticket guard must fail before its own extras are
 * attached to a ticket that will not exist.
 */
const cartSettlementPriority = (kind: OrderKind): number => {
  if (kind === 'ticket') return 0;
  if (kind === 'extras_only') return 1;
  return 2;
};

export const settleAbacatePayCart = async (params: {
  cartId: string;
  providerRef: string;
  env: IssueEnv;
  /** See settlePaidOrder's `livemode` param. Omitted ⇒ column keeps its default. */
  livemode?: boolean;
}): Promise<CartSettlementResult> => {
  const { cartId, providerRef, env, livemode } = params;

  const cartOrders = await prisma.order.findMany({
    where: { cartId, provider: 'abacatepay', status: 'pending' },
    select: { id: true, userId: true, eventId: true, amountCents: true, kind: true },
    orderBy: { createdAt: 'asc' },
  });

  // Nothing pending: a replay, or a cart the caller already settled earlier in
  // the same sweep. Do NOT touch Cart.status here — the caller that DID settle
  // it already converted it, and an orphan-billing cart (no local orders at
  // all) must stay as it is so the webhook's orphan branch keeps owning it.
  if (cartOrders.length === 0) {
    return { orders: [], issuedAnyTicket: false, userId: null };
  }

  const ordered = [...cartOrders].sort(
    (a, b) => cartSettlementPriority(a.kind) - cartSettlementPriority(b.kind),
  );
  // Post-sort, exactly like the webhook's own `cartOrders[0]?.userId` after its
  // in-place sort. Every order in a cart belongs to the same user, so this only
  // matters for keeping the two paths literally identical.
  const firstUserId = ordered[0]?.userId ?? null;

  let issuedAnyTicket = false;
  for (const order of ordered) {
    try {
      const settled = await settlePaidOrder(order.id, providerRef, env, { cartId }, livemode);
      if (
        settled.kind === 'ticket' ||
        settled.kind === 'extras_only' ||
        (settled.kind === 'mixed' && (settled.issued?.length ?? 0) > 0)
      ) {
        issuedAnyTicket = true;
      }
    } catch (err) {
      if (err instanceof TicketAlreadyExistsForEventError) {
        flagManualRefund({
          orderId: order.id,
          providerRef,
          userId: order.userId,
          eventId: order.eventId,
          reason: 'duplicate-ticket',
        });
        continue;
      }
      if (err instanceof TicketRevokedForExtrasOnlyError) {
        flagManualRefund({
          orderId: order.id,
          providerRef,
          userId: order.userId,
          eventId: order.eventId,
          reason: 'ticket-revoked',
        });
        continue;
      }
      if (err instanceof OrderNotPendingError) {
        continue;
      }
      if (err instanceof EventPickupAssignmentUnavailableError) {
        flagManualRefund({
          orderId: order.id,
          providerRef,
          userId: order.userId,
          eventId: order.eventId,
          reason: 'pickup-ticket-unavailable',
        });
        continue;
      }
      throw err;
    }
  }

  // The write the worker was missing. Runs even when every single order above
  // was flagged for manual refund: the cart's items are spoken for either way,
  // and leaving it `checking_out` is what strands the customer.
  await prisma.cart.update({ where: { id: cartId }, data: { status: 'converted' } });

  return { orders: ordered, issuedAnyTicket, userId: firstUserId };
};
