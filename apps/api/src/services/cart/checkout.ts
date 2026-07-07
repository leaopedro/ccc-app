import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';

import {
  ORDER_EXPIRY_MS,
  sweepExpiredOrdersForTier,
  sweepExpiredOrdersForVariant,
} from '../orders/expire.js';
import {
  PendingTicketOrderForEventError,
  findPendingTicketOrderForEvent,
} from '../orders/pending-guard.js';
import { reserveExtras, validateTickets } from '../orders/validate-tickets.js';
import { applyDevFee } from '../pricing/dev-fee.js';

type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        extras: true;
        tier: {
          select: {
            priceCents: true;
            currency: true;
            requiresCar: true;
            quantityTotal: true;
            quantitySold: true;
          };
        };
        variant: {
          select: {
            id: true;
            productId: true;
            priceCents: true;
            quantityTotal: true;
            quantitySold: true;
            active: true;
            name: true;
            product: {
              select: {
                id: true;
                title: true;
                status: true;
                currency: true;
                allowPickup: true;
                allowShip: true;
                shippingFeeCents: true;
                virtual: true;
                productType: { select: { name: true } };
              };
            };
          };
        };
      };
    };
  };
}>;

export type CartOrder = {
  id: string;
  eventId: string | null;
  tierId: string | null;
  variantId: string | null;
  amountCents: number;
  quantity: number;
  kind: 'ticket' | 'extras_only' | 'product' | 'mixed';
  description: string;
};

export type CheckoutResult = {
  cartId: string;
  orders: CartOrder[];
  // Gross charged total: baseAmountCents + devFeeAmountCents + shippingCents.
  totalAmountCents: number;
  baseAmountCents: number;
  devFeePercent: number;
  devFeeAmountCents: number;
  shippingCents: number;
  currency: string;
  expiredProviderRefs: string[];
};

const CART_CHECKOUT_INCLUDE = {
  items: {
    include: {
      extras: true,
      tier: {
        select: {
          priceCents: true,
          currency: true,
          requiresCar: true,
          quantityTotal: true,
          quantitySold: true,
        },
      },
      variant: {
        select: {
          id: true,
          productId: true,
          priceCents: true,
          quantityTotal: true,
          quantitySold: true,
          active: true,
          name: true,
          product: {
            select: {
              id: true,
              title: true,
              status: true,
              currency: true,
              allowPickup: true,
              allowShip: true,
              shippingFeeCents: true,
              virtual: true,
              productType: { select: { name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export async function loadCartForCheckout(
  userId: string,
): Promise<
  { ok: true; cart: CartWithItems } | { ok: false; status: number; error: string; message: string }
> {
  const cart = await prisma.cart.findFirst({
    where: { userId, status: { in: ['open', 'checking_out'] } },
    include: CART_CHECKOUT_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });

  if (!cart || cart.items.length === 0) {
    return { ok: false, status: 422, error: 'UnprocessableEntity', message: 'cart is empty' };
  }

  return { ok: true, cart };
}

export type CartCheckoutMethod = 'card' | 'pix';

const PROVIDER_FOR_METHOD: Record<CartCheckoutMethod, 'stripe' | 'abacatepay'> = {
  card: 'stripe',
  pix: 'abacatepay',
};

type PreparedOrderItemRow = {
  kind: 'ticket' | 'product' | 'extras';
  eventId?: string | null;
  tierId?: string | null;
  variantId?: string | null;
  extraId?: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  tickets?: Prisma.InputJsonValue;
};

type PreparedOrderExtraRow = {
  extraId: string;
  quantity: number;
};

type PreparedCartItem = {
  cartItemKind: 'ticket' | 'extras_only' | 'product';
  orderItemRows: PreparedOrderItemRow[];
  orderExtraRows: PreparedOrderExtraRow[];
  amountCents: number;
  quantity: number;
  currency: string;
  description: string;
  eventId: string | null;
  tierId: string | null;
  variantId: string | null;
  shippingCents: number;
  shippingAddressId: string | null;
  fulfillmentMethod: 'pickup' | 'ship' | 'virtual';
};

export async function reserveAndCreateOrders(
  cart: CartWithItems,
  userId: string,
  options: {
    method: CartCheckoutMethod;
    shippingAddressId?: string | null;
    pickupEventId?: string | null;
    fulfillmentMethod?: 'pickup' | 'ship' | null;
    devFeePercent: number;
  },
): Promise<
  | { ok: true; data: CheckoutResult }
  | { ok: false; status: number; error: string; message: string; code?: string }
> {
  const method = options.method;
  const provider = PROVIDER_FOR_METHOD[method];
  const allExpiredRefs: string[] = [];

  // Primary-shipping selection must ignore virtual products. Virtual lines have
  // shipping zeroed in prepareProductCartItem, so if a virtual line "won" this
  // reducer the order would carry zero shipping even when a physical sibling
  // exists with a non-zero fee. Filter to physical (non-virtual) products only.
  const primaryShippingCartItemId = cart.items.reduce<string | null>((selectedId, item) => {
    if (item.kind !== 'product' || !item.variant) return selectedId;
    if (item.variant.product.virtual) return selectedId;
    const shippingFeeCents = item.variant.product.shippingFeeCents ?? 0;
    if (shippingFeeCents <= 0) return selectedId;
    if (!selectedId) return item.id;
    const selectedItem = cart.items.find((candidate) => candidate.id === selectedId);
    const selectedShippingFeeCents =
      selectedItem?.kind === 'product' && selectedItem.variant
        ? (selectedItem.variant.product.shippingFeeCents ?? 0)
        : 0;
    return shippingFeeCents > selectedShippingFeeCents ? item.id : selectedId;
  }, null);

  try {
    const singleOrder = await prisma.$transaction(async (tx) => {
      const preparedItems: PreparedCartItem[] = [];

      for (const item of cart.items) {
        if (item.kind === 'product') {
          const prepared = await prepareProductCartItem(
            item,
            item.id === primaryShippingCartItemId,
            options.shippingAddressId ?? null,
            options.pickupEventId ?? null,
            options.fulfillmentMethod ?? null,
            tx,
            allExpiredRefs,
          );
          preparedItems.push(prepared);
          continue;
        }

        const prepared = await prepareTicketCartItem(item, userId, tx, allExpiredRefs);
        preparedItems.push(prepared);
      }

      // Order kind invariant: a homogeneous discriminator (`ticket` /
      // `extras_only` / `product`) is reserved for single-line carts where
      // `Order.eventId`/`tierId` (or `variantId`) can be pinned. Any cart with
      // more than one prepared item must use `mixed` so settlement reads scope
      // from `OrderItem` rows; otherwise multi-event ticket-only or extras-only
      // carts reach `issueTicketForPaidOrder` with null eventId/tierId.
      const orderKind: 'ticket' | 'extras_only' | 'product' | 'mixed' =
        preparedItems.length === 1 ? preparedItems[0]!.cartItemKind : 'mixed';

      // PreparedCartItem.amountCents already mixes sellable subtotal + shipping
      // (product path bundles shipping into the line). Separate them so the dev
      // fee applies to sellable amounts only and shipping stays a pass-through.
      const baseAmountCents = preparedItems.reduce(
        (sum, p) => sum + (p.amountCents - p.shippingCents),
        0,
      );
      const fee = applyDevFee(baseAmountCents, options.devFeePercent);
      const totalQuantity = preparedItems.reduce((sum, p) => sum + p.quantity, 0);
      const currency = preparedItems.find((p) => p.currency)?.currency ?? 'BRL';
      const description = preparedItems.map((p) => p.description).join(' + ');

      // For homogeneous single-item orders, carry forward the scoped ids
      const isSingleTicketItem =
        preparedItems.length === 1 && (orderKind === 'ticket' || orderKind === 'extras_only');
      const isSingleProductItem = preparedItems.length === 1 && orderKind === 'product';
      const singleEventId = isSingleTicketItem ? preparedItems[0]!.eventId : null;
      const singleTierId = isSingleTicketItem ? preparedItems[0]!.tierId : null;
      const singleVariantId = isSingleProductItem ? preparedItems[0]!.variantId : null;

      // Shipping applies to the whole order (cart has one shipping address)
      const shippingCents = preparedItems.reduce((sum, p) => sum + p.shippingCents, 0);
      const totalAmountCents = fee.grossAmountCents + shippingCents;
      const hasShippable = preparedItems.some((p) => p.fulfillmentMethod === 'ship');
      const hasPhysical = preparedItems.some(
        (p) => p.fulfillmentMethod === 'ship' || p.fulfillmentMethod === 'pickup',
      );
      const cartFulfillmentMethod: 'pickup' | 'ship' | 'virtual' = hasShippable
        ? 'ship'
        : hasPhysical
          ? 'pickup'
          : 'virtual';
      const cartShippingAddressId = hasShippable ? (options.shippingAddressId ?? null) : null;

      const cartGuard = await tx.cart.updateMany({
        where: { id: cart.id, status: 'open' },
        data: { status: 'checking_out' },
      });
      if (cartGuard.count === 0) {
        throw Object.assign(new Error('cart is already checking out'), {
          code: 'CART_ALREADY_CHECKING_OUT',
        });
      }

      const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MS);
      const order = await tx.order.create({
        data: {
          userId,
          eventId: singleEventId,
          tierId: singleTierId,
          cartId: cart.id,
          pickupEventId: options.pickupEventId ?? null,
          kind: orderKind,
          amountCents: totalAmountCents,
          baseAmountCents: fee.baseAmountCents,
          devFeePercent: fee.devFeePercent,
          devFeeAmountCents: fee.devFeeAmountCents,
          quantity: totalQuantity,
          currency,
          method,
          provider,
          shippingAddressId: cartShippingAddressId,
          shippingCents,
          fulfillmentMethod: cartFulfillmentMethod,
          status: 'pending',
          expiresAt,
        },
      });

      const allOrderItemRows: PreparedOrderItemRow[] = preparedItems.flatMap(
        (p) => p.orderItemRows,
      );
      const allOrderExtraRows: PreparedOrderExtraRow[] = preparedItems.flatMap(
        (p) => p.orderExtraRows,
      );

      if (allOrderItemRows.length > 0) {
        await tx.orderItem.createMany({
          data: allOrderItemRows.map((row) => ({ ...row, orderId: order.id })),
        });
      }

      if (allOrderExtraRows.length > 0) {
        await tx.orderExtra.createMany({
          data: allOrderExtraRows.map((row) => ({ ...row, orderId: order.id })),
          skipDuplicates: true,
        });
      }

      return {
        order: {
          id: order.id,
          eventId: singleEventId,
          tierId: singleTierId,
          variantId: singleVariantId,
          amountCents: totalAmountCents,
          quantity: totalQuantity,
          kind: orderKind,
          description,
        } satisfies CartOrder,
        currency,
        shippingCents,
        baseAmountCents: fee.baseAmountCents,
        devFeePercent: fee.devFeePercent,
        devFeeAmountCents: fee.devFeeAmountCents,
      };
    });

    return {
      ok: true,
      data: {
        cartId: cart.id,
        orders: [singleOrder.order],
        totalAmountCents: singleOrder.order.amountCents,
        baseAmountCents: singleOrder.baseAmountCents,
        devFeePercent: singleOrder.devFeePercent,
        devFeeAmountCents: singleOrder.devFeeAmountCents,
        shippingCents: singleOrder.shippingCents,
        currency: singleOrder.currency,
        expiredProviderRefs: allExpiredRefs,
      },
    };
  } catch (err) {
    if (err instanceof PendingTicketOrderForEventError) {
      return {
        ok: false,
        status: 409,
        error: 'Conflict',
        code: 'PENDING_TICKET_ORDER_FOR_EVENT',
        message: 'already have a pending ticket order for this event',
      };
    }
    const coded = err as Error & { code?: string };
    if (
      coded.code === 'TIER_SOLD_OUT' ||
      coded.code === 'EXTRA_SOLD_OUT' ||
      coded.code === 'VARIANT_SOLD_OUT' ||
      coded.code === 'VARIANT_NOT_ACTIVE' ||
      coded.code === 'CART_ALREADY_CHECKING_OUT' ||
      coded.code === 'CART_ITEM_INVALID'
    ) {
      return { ok: false, status: 409, error: 'Conflict', message: coded.message };
    }
    throw err;
  }
}

type ProductCartItem = CartWithItems['items'][number] & {
  variant: NonNullable<CartWithItems['items'][number]['variant']>;
};

async function prepareProductCartItem(
  item: CartWithItems['items'][number],
  isPrimaryShipping: boolean,
  shippingAddressId: string | null,
  pickupEventId: string | null,
  requestedFulfillmentMethod: 'pickup' | 'ship' | null,
  tx: Prisma.TransactionClient,
  expiredRefs: string[],
): Promise<PreparedCartItem> {
  if (!item.variantId || !item.variant) {
    throw Object.assign(new Error('product cart item missing variant'), {
      code: 'CART_ITEM_INVALID',
    });
  }
  const productItem = item as ProductCartItem;
  const variant = productItem.variant;

  if (!variant.active || variant.product.status !== 'active') {
    throw Object.assign(new Error(`variant ${variant.id} not active`), {
      code: 'VARIANT_NOT_ACTIVE',
    });
  }

  if (!variant.product.virtual) {
    const sweep = await sweepExpiredOrdersForVariant(variant.id, tx);
    expiredRefs.push(...sweep.expiredProviderRefs);

    const reservation = await tx.variant.updateMany({
      where: { id: variant.id, quantitySold: { lte: variant.quantityTotal - item.quantity } },
      data: { quantitySold: { increment: item.quantity } },
    });
    if (reservation.count === 0) {
      throw Object.assign(new Error(`variant ${variant.id} sold out`), {
        code: 'VARIANT_SOLD_OUT',
        variantId: variant.id,
      });
    }
  } else if (item.quantity !== 1) {
    // Defense-in-depth: validateProductCartItem already rejects qty>1 for virtual
    // items at add/update. A stale row with qty>1 would charge for N spots but
    // only fulfill 1 (one GarageSpot per OrderItem). Block at checkout too.
    throw Object.assign(new Error(`virtual variant ${variant.id} requires quantity 1`), {
      code: 'CART_ITEM_INVALID',
    });
  }

  const allowPickup = variant.product.allowPickup;
  const allowShip = variant.product.allowShip;
  let fulfillmentMethod: 'pickup' | 'ship' | 'virtual';
  if (variant.product.virtual) {
    fulfillmentMethod = 'virtual';
  } else if (requestedFulfillmentMethod === 'pickup' && allowPickup) {
    fulfillmentMethod = 'pickup';
  } else if (requestedFulfillmentMethod === 'ship' && allowShip) {
    fulfillmentMethod = 'ship';
  } else {
    // Back-compat fallback when caller did not pass an explicit method.
    fulfillmentMethod = allowShip && shippingAddressId ? 'ship' : allowPickup ? 'pickup' : 'ship';
  }
  const appliedShippingCents =
    fulfillmentMethod === 'virtual'
      ? 0
      : isPrimaryShipping
        ? (variant.product.shippingFeeCents ?? 0)
        : 0;
  const shippingCents = fulfillmentMethod === 'ship' ? appliedShippingCents : 0;
  const amountCents = variant.priceCents * item.quantity + shippingCents;

  return {
    cartItemKind: 'product',
    orderItemRows: [
      {
        kind: 'product',
        variantId: variant.id,
        quantity: item.quantity,
        unitPriceCents: variant.priceCents,
        subtotalCents: variant.priceCents * item.quantity,
      },
    ],
    orderExtraRows: [],
    amountCents,
    quantity: item.quantity,
    currency: variant.product.currency,
    description: `${variant.product.title} — ${variant.name}`,
    eventId: null,
    tierId: null,
    variantId: variant.id,
    shippingCents,
    shippingAddressId: fulfillmentMethod === 'ship' ? shippingAddressId : null,
    fulfillmentMethod: fulfillmentMethod,
  };
}

async function prepareTicketCartItem(
  item: CartWithItems['items'][number],
  userId: string,
  tx: Prisma.TransactionClient,
  expiredRefs: string[],
): Promise<PreparedCartItem> {
  const isExtrasOnly = item.kind === 'extras_only';
  const tickets = item.tickets as Array<{
    carId?: string;
    licensePlate?: string;
    extras?: string[];
  }>;

  if (!item.tierId || !item.eventId) {
    throw Object.assign(new Error('ticket cart item missing eventId/tierId'), {
      code: 'CART_ITEM_INVALID',
    });
  }

  const tier = await tx.ticketTier.findUniqueOrThrow({
    where: { id: item.tierId },
    select: {
      id: true,
      requiresCar: true,
      quantityTotal: true,
      quantitySold: true,
      priceCents: true,
      currency: true,
      eventId: true,
    },
  });

  const sweep = await sweepExpiredOrdersForTier(tier.id, tx);
  expiredRefs.push(...sweep.expiredProviderRefs);

  if (!isExtrasOnly) {
    const pending = await findPendingTicketOrderForEvent(tx, userId, item.eventId);
    if (pending) {
      throw new PendingTicketOrderForEventError(userId, item.eventId, pending.id);
    }
  }

  if (!isExtrasOnly) {
    const reservation = await tx.ticketTier.updateMany({
      where: { id: tier.id, quantitySold: { lte: tier.quantityTotal - item.quantity } },
      data: { quantitySold: { increment: item.quantity } },
    });
    if (reservation.count === 0) {
      throw Object.assign(new Error(`tier ${tier.id} sold out`), {
        code: 'TIER_SOLD_OUT',
        tierId: tier.id,
      });
    }
  }

  const ticketInputs = tickets.map((t) => ({
    extras: t.extras ?? [],
    carId: t.carId,
    licensePlate: t.licensePlate,
  }));

  const validation = await validateTickets(
    ticketInputs,
    { requiresCar: tier.requiresCar },
    item.eventId,
    tx,
    userId,
    { skipCarValidation: isExtrasOnly },
  );

  await reserveExtras(validation.extraStock, tx);

  const event = await tx.event.findUniqueOrThrow({
    where: { id: item.eventId },
    select: { title: true },
  });

  const orderItemRows: PreparedOrderItemRow[] = [];
  const orderExtraRows: PreparedOrderExtraRow[] = [];

  if (!isExtrasOnly) {
    const ticketSubtotal = tier.priceCents * item.quantity;
    orderItemRows.push({
      kind: 'ticket',
      eventId: item.eventId,
      tierId: tier.id,
      quantity: item.quantity,
      unitPriceCents: tier.priceCents,
      subtotalCents: ticketSubtotal,
      ...(tickets.length > 0 ? { tickets: tickets as Prisma.InputJsonValue } : {}),
    });
  }

  if (validation.extraEntries.length > 0) {
    for (const { extraId, priceCents, quantity } of validation.extraEntries) {
      orderItemRows.push({
        kind: 'extras',
        eventId: item.eventId,
        extraId,
        quantity,
        unitPriceCents: priceCents,
        subtotalCents: priceCents * quantity,
      });
      orderExtraRows.push({ extraId, quantity });
    }
  }

  return {
    cartItemKind: isExtrasOnly ? 'extras_only' : 'ticket',
    orderItemRows,
    orderExtraRows,
    amountCents: item.amountCents,
    quantity: item.quantity,
    currency: tier.currency,
    description: event.title,
    eventId: item.eventId,
    tierId: tier.id,
    variantId: null,
    shippingCents: 0,
    shippingAddressId: null,
    fulfillmentMethod: 'pickup',
  };
}

export async function rollbackCartCheckout(cartId: string, orders: CartOrder[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const order of orders) {
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { kind: true, tierId: true, variantId: true, quantity: true },
      });

      for (const item of items) {
        if (item.kind === 'ticket' && item.tierId) {
          await tx.ticketTier.updateMany({
            where: { id: item.tierId, quantitySold: { gte: item.quantity } },
            data: { quantitySold: { decrement: item.quantity } },
          });
        } else if (item.kind === 'product' && item.variantId) {
          await tx.variant.updateMany({
            where: { id: item.variantId, quantitySold: { gte: item.quantity } },
            data: { quantitySold: { decrement: item.quantity } },
          });
        }
      }

      const orderExtras = await tx.orderExtra.findMany({
        where: { orderId: order.id },
        select: { extraId: true, quantity: true },
      });
      for (const { extraId, quantity } of orderExtras) {
        await tx.ticketExtra.updateMany({
          where: { id: extraId, quantitySold: { gte: quantity } },
          data: { quantitySold: { decrement: quantity } },
        });
      }

      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      await tx.orderExtra.deleteMany({ where: { orderId: order.id } });
      await tx.order.delete({ where: { id: order.id } });
    }

    await tx.cart.update({
      where: { id: cartId },
      data: { status: 'open' },
    });
  });
}
