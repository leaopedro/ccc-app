import { prisma } from '@ccc/db';
import type {
  Cart,
  CartItem,
  CartItemInput,
  CartItemProduct,
  CartTotals,
  EvictedCartItem,
  FulfillmentMethod,
} from '@ccc/shared/cart';
import type { Prisma } from '@prisma/client';

import { applyDevFee } from '../pricing/dev-fee.js';
import { ensureStoreSettings } from '../store-settings.js';

export type CartFulfillmentContext = { eventPickupEnabled: boolean };

export async function loadCartFulfillmentContext(): Promise<CartFulfillmentContext> {
  const settings = await ensureStoreSettings();
  return { eventPickupEnabled: settings.eventPickupEnabled };
}

type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        extras: true;
        tier: { select: { priceCents: true; currency: true; requiresCar: true } };
        variant: {
          select: {
            id: true;
            productId: true;
            name: true;
            sku: true;
            priceCents: true;
            attributes: true;
            active: true;
            quantityTotal: true;
            quantitySold: true;
            product: {
              select: {
                id: true;
                slug: true;
                title: true;
                currency: true;
                allowPickup: true;
                allowShip: true;
                shippingFeeCents: true;
                virtual: true;
              };
            };
          };
        };
      };
    };
  };
}>;

export const CART_INCLUDE_FOR_SERIALIZE = {
  items: {
    include: {
      extras: true,
      tier: { select: { priceCents: true, currency: true, requiresCar: true } },
      variant: {
        select: {
          id: true,
          productId: true,
          name: true,
          sku: true,
          priceCents: true,
          attributes: true,
          active: true,
          quantityTotal: true,
          quantitySold: true,
          product: {
            select: {
              id: true,
              slug: true,
              title: true,
              currency: true,
              allowPickup: true,
              allowShip: true,
              shippingFeeCents: true,
              virtual: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export async function getActiveCart(userId: string): Promise<CartWithItems | null> {
  return prisma.cart.findFirst({
    where: { userId, status: 'open' },
    include: CART_INCLUDE_FOR_SERIALIZE,
  });
}

export async function getOrCreateCart(userId: string): Promise<CartWithItems> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.cart.findFirst({
            where: { userId, status: 'open' },
            include: CART_INCLUDE_FOR_SERIALIZE,
          });
          if (existing) return existing;
          return tx.cart.create({
            data: { userId, status: 'open' },
            include: CART_INCLUDE_FOR_SERIALIZE,
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
      if (code === 'P2034' || code === 'P2002') {
        const found = await prisma.cart.findFirst({
          where: { userId, status: 'open' },
          include: CART_INCLUDE_FOR_SERIALIZE,
        });
        if (found) return found;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to get or create cart after retries');
}

export function computeItemAmount(
  pricing: {
    tierPriceCents?: number;
    variantPriceCents?: number;
    shippingFeeCents?: number | null;
  },
  quantity: number,
  extras: { subtotalCents: number }[],
  kind: 'ticket' | 'extras_only' | 'product' = 'ticket',
): number {
  if (kind === 'product') {
    return (pricing.variantPriceCents ?? 0) * quantity;
  }
  const tierTotal = kind === 'ticket' ? (pricing.tierPriceCents ?? 0) * quantity : 0;
  const extrasTotal = extras.reduce((sum, e) => sum + e.subtotalCents, 0);
  return tierTotal + extrasTotal;
}

const getMaxShippingSubtotalCents = (items: CartWithItems['items']): number =>
  items.reduce((max, item) => {
    if (item.kind !== 'product' || !item.variant) return max;
    // Virtual products (e.g. garage spot) never ship; even if seed data ever
    // carries a non-zero shippingFeeCents on a virtual product, do not let it
    // leak into cart totals. Defensive zero.
    if (item.variant.product.virtual) return max;
    return Math.max(max, item.variant.product.shippingFeeCents ?? 0);
  }, 0);

export function computeCartTotals(
  items: CartWithItems['items'],
  options: { devFeePercent: number },
): CartTotals {
  let ticketSubtotalCents = 0;
  let extrasSubtotalCents = 0;
  let productsSubtotalCents = 0;

  for (const item of items) {
    if (item.kind === 'ticket' && item.tier) {
      ticketSubtotalCents += item.tier.priceCents * item.quantity;
    }
    if (item.kind === 'product' && item.variant) {
      productsSubtotalCents += item.variant.priceCents * item.quantity;
    }
    for (const extra of item.extras) {
      extrasSubtotalCents += extra.subtotalCents;
    }
  }

  const shippingSubtotalCents = getMaxShippingSubtotalCents(items);
  const discountCents = 0;
  const baseAmountCents =
    ticketSubtotalCents + extrasSubtotalCents + productsSubtotalCents - discountCents;
  const fee = applyDevFee(baseAmountCents, options.devFeePercent);
  const amountCents = fee.grossAmountCents + shippingSubtotalCents;

  return {
    ticketSubtotalCents,
    extrasSubtotalCents,
    productsSubtotalCents,
    shippingSubtotalCents,
    discountCents,
    baseAmountCents: fee.baseAmountCents,
    devFeePercent: fee.devFeePercent,
    devFeeAmountCents: fee.devFeeAmountCents,
    amountCents,
    currency: 'BRL',
  };
}

export type FulfillmentCompatibilityResult =
  | { compatible: true }
  | { compatible: false; conflictingItemIds: string[] };

export type CartItemForFulfillment = {
  id: string;
  kind: string;
  variant: {
    product: { allowShip: boolean; allowPickup: boolean; virtual: boolean };
  } | null;
};

export function findIncompatibleProducts(
  existingItems: CartItemForFulfillment[],
  candidateAllowShip: boolean,
  candidateAllowPickup: boolean,
  context: CartFulfillmentContext,
  options: { excludeCartItemId?: string } = {},
): FulfillmentCompatibilityResult {
  const productItems = existingItems.filter(
    (item) =>
      item.kind === 'product' &&
      !!item.variant &&
      !item.variant.product.virtual &&
      (!options.excludeCartItemId || item.id !== options.excludeCartItemId),
  );

  const candidatePickupAvailable = candidateAllowPickup && context.eventPickupEnabled;
  const candidateShipAvailable = candidateAllowShip;
  const conflicting: string[] = [];

  for (const item of productItems) {
    const itemPickupAvailable = item.variant!.product.allowPickup && context.eventPickupEnabled;
    const itemShipAvailable = item.variant!.product.allowShip;
    const sharesPickup = candidatePickupAvailable && itemPickupAvailable;
    const sharesShip = candidateShipAvailable && itemShipAvailable;
    if (!sharesPickup && !sharesShip) {
      conflicting.push(item.id);
    }
  }

  if (conflicting.length === 0) return { compatible: true };
  return { compatible: false, conflictingItemIds: conflicting };
}

export function computeAvailableFulfillmentMethods(
  items: CartItemForFulfillment[],
  context: CartFulfillmentContext,
): FulfillmentMethod[] {
  const productItems = items.filter((item) => item.kind === 'product' && !!item.variant);
  if (productItems.length === 0) return [];

  const physicalProductItems = productItems.filter((item) => !item.variant!.product.virtual);
  // All-virtual carts: no pickup or ship needed at all. Caller path treats this
  // as "no fulfillment method required" and the order row gets fulfillmentMethod='virtual'.
  if (physicalProductItems.length === 0) return [];

  const everyCanPickup = physicalProductItems.every((item) => item.variant!.product.allowPickup);
  const everyCanShip = physicalProductItems.every((item) => item.variant!.product.allowShip);

  const methods: FulfillmentMethod[] = [];
  if (everyCanPickup && context.eventPickupEnabled) methods.push('pickup');
  if (everyCanShip) methods.push('ship');
  return methods;
}

export function serializeCart(
  cart: CartWithItems,
  context: CartFulfillmentContext,
  options: { devFeePercent: number },
): Cart {
  const items: CartItem[] = cart.items.map((item) => {
    const product: CartItemProduct | null = item.variant
      ? {
          productId: item.variant.product.id,
          productTitle: item.variant.product.title,
          productSlug: item.variant.product.slug,
          variantId: item.variant.id,
          variantName: item.variant.name,
          variantSku: item.variant.sku,
          unitPriceCents: item.variant.priceCents,
          canShip: item.variant.product.allowShip,
          canPickup: item.variant.product.allowPickup,
          shippingFeeCents: item.variant.product.shippingFeeCents,
          attributes: (item.variant.attributes as Record<string, unknown> | null) ?? null,
        }
      : null;

    const amountCents = computeItemAmount(
      item.variant
        ? {
            variantPriceCents: item.variant.priceCents,
            shippingFeeCents: item.variant.product.shippingFeeCents,
          }
        : item.tier
          ? { tierPriceCents: item.tier.priceCents }
          : {},
      item.quantity,
      item.extras,
      item.kind as CartItem['kind'],
    );

    return {
      id: item.id,
      eventId: item.eventId,
      tierId: item.tierId,
      variantId: item.variantId,
      source: item.source as 'purchase',
      kind: item.kind as CartItem['kind'],
      quantity: item.quantity,
      requiresCar: item.tier?.requiresCar ?? false,
      tickets: item.tickets as CartItem['tickets'],
      extras: item.extras.map((e) => ({
        extraId: e.extraId,
        quantity: e.quantity,
        unitPriceCents: e.unitPriceCents,
        subtotalCents: e.subtotalCents,
      })),
      product,
      amountCents,
      currency: item.currency,
      reservationExpiresAt: item.reservationExpiresAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  const totals = computeCartTotals(cart.items, { devFeePercent: options.devFeePercent });
  const availableFulfillmentMethods = computeAvailableFulfillmentMethods(cart.items, context);

  return {
    id: cart.id,
    userId: cart.userId,
    status: cart.status as Cart['status'],
    items,
    totals,
    availableFulfillmentMethods,
    version: cart.version,
    expiresAt: cart.expiresAt?.toISOString() ?? null,
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
  };
}

export async function evictStaleItems(cart: CartWithItems): Promise<EvictedCartItem[]> {
  const evicted: EvictedCartItem[] = [];
  const idsToDelete: string[] = [];

  for (const item of cart.items) {
    if (item.kind === 'product') {
      if (!item.variantId) {
        evicted.push({
          itemId: item.id,
          reason: 'variant_removed',
          message: 'Variant is no longer available',
        });
        idsToDelete.push(item.id);
        continue;
      }
      const variant = await prisma.variant.findUnique({
        where: { id: item.variantId },
        select: {
          id: true,
          active: true,
          quantityTotal: true,
          quantitySold: true,
          product: { select: { virtual: true } },
        },
      });
      if (!variant) {
        evicted.push({
          itemId: item.id,
          reason: 'variant_removed',
          message: 'Variant is no longer available',
        });
        idsToDelete.push(item.id);
        continue;
      }
      if (!variant.active) {
        evicted.push({
          itemId: item.id,
          reason: 'variant_inactive',
          message: 'Variant is no longer active',
        });
        idsToDelete.push(item.id);
        continue;
      }
      // Virtual products (e.g. garage spot) do not reserve Variant stock, so
      // the quantityTotal/quantitySold accounting never applies. Skip the
      // sold-out check; otherwise a virtual variant with default 0/0 stock
      // would be evicted as "sold out".
      if (
        !variant.product.virtual &&
        variant.quantityTotal - variant.quantitySold < item.quantity
      ) {
        evicted.push({
          itemId: item.id,
          reason: 'variant_sold_out',
          message: 'Variant is sold out',
        });
        idsToDelete.push(item.id);
      }
      continue;
    }

    if (!item.eventId || !item.tierId) {
      idsToDelete.push(item.id);
      continue;
    }
    const event = await prisma.event.findUnique({
      where: { id: item.eventId },
      select: { status: true },
    });

    if (!event || event.status !== 'published') {
      const reason = event?.status === 'cancelled' ? 'event_cancelled' : 'event_unpublished';
      evicted.push({
        itemId: item.id,
        reason,
        message: `Event is ${reason === 'event_cancelled' ? 'cancelled' : 'no longer published'}`,
      });
      idsToDelete.push(item.id);
      continue;
    }

    const tier = await prisma.ticketTier.findUnique({
      where: { id: item.tierId },
      select: { id: true, eventId: true },
    });

    if (!tier || tier.eventId !== item.eventId) {
      evicted.push({
        itemId: item.id,
        reason: 'tier_removed',
        message: 'Ticket tier is no longer available',
      });
      idsToDelete.push(item.id);
      continue;
    }

    let extraStale = false;
    for (const cartExtra of item.extras) {
      const extra = await prisma.ticketExtra.findUnique({
        where: { id: cartExtra.extraId },
        select: { id: true, eventId: true, active: true, quantityTotal: true, quantitySold: true },
      });

      if (!extra || extra.eventId !== item.eventId || !extra.active) {
        evicted.push({
          itemId: item.id,
          reason: 'extra_removed',
          message: `Extra ${cartExtra.extraId} is no longer available`,
        });
        idsToDelete.push(item.id);
        extraStale = true;
        break;
      }

      if (
        extra.quantityTotal !== null &&
        extra.quantityTotal - extra.quantitySold < cartExtra.quantity
      ) {
        evicted.push({
          itemId: item.id,
          reason: 'extra_sold_out',
          message: `Extra ${cartExtra.extraId} is sold out`,
        });
        idsToDelete.push(item.id);
        extraStale = true;
        break;
      }
    }
    if (extraStale) continue;
  }

  if (idsToDelete.length > 0) {
    await prisma.cartItem.deleteMany({
      where: { id: { in: idsToDelete } },
    });
    console.log('cart.evict', { cartId: cart.id, evicted: idsToDelete.length });
  }

  return evicted;
}

function codedError(
  message: string,
  code: string,
  status: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode: status });
}

export type ValidatedCartItem =
  | {
      kind: 'ticket' | 'extras_only';
      event: { id: string; maxTicketsPerUser: number | null };
      tier: { id: string; priceCents: number; currency: string; requiresCar: boolean };
      variant: null;
    }
  | {
      kind: 'product';
      event: null;
      tier: null;
      variant: {
        id: string;
        productId: string;
        priceCents: number;
        currency: string;
        shippingFeeCents: number | null;
        allowShip: boolean;
        allowPickup: boolean;
        virtual: boolean;
      };
    };

export async function validateCartItem(
  input: CartItemInput,
  userId: string,
  excludeCartItemId?: string,
): Promise<ValidatedCartItem> {
  if (input.kind === 'product') {
    return validateProductCartItem(input, excludeCartItemId);
  }

  if (!input.eventId || !input.tierId) {
    throw codedError('eventId and tierId are required', 'EVENT_NOT_FOUND', 404);
  }

  const event = await prisma.event.findFirst({
    where: { id: input.eventId, status: 'published' },
    select: { id: true, maxTicketsPerUser: true },
  });
  if (!event) {
    throw codedError('Event not found or not published', 'EVENT_NOT_FOUND', 404);
  }

  const tier = await prisma.ticketTier.findFirst({
    where: { id: input.tierId, eventId: input.eventId },
    select: {
      id: true,
      priceCents: true,
      currency: true,
      quantityTotal: true,
      quantitySold: true,
      requiresCar: true,
      salesOpenAt: true,
      salesCloseAt: true,
    },
  });
  if (!tier) {
    throw codedError('Tier not found for this event', 'TIER_NOT_FOUND', 404);
  }

  const now = new Date();
  if (tier.salesOpenAt && now < tier.salesOpenAt) {
    throw codedError('Sales have not opened yet for this tier', 'SALES_NOT_OPEN', 409);
  }
  if (tier.salesCloseAt && now > tier.salesCloseAt) {
    throw codedError('Sales have closed for this tier', 'SALES_CLOSED', 409);
  }

  const available = tier.quantityTotal - tier.quantitySold;
  if (available < input.quantity) {
    throw codedError(`Only ${available} ticket(s) remaining`, 'TIER_SOLD_OUT', 409);
  }

  const existingTickets = await prisma.ticket.count({
    where: {
      userId,
      eventId: input.eventId,
      status: { in: ['valid', 'used'] },
    },
  });

  const pendingWhere: Prisma.CartItemWhereInput = {
    cart: { userId, status: 'open' },
    eventId: input.eventId,
    kind: 'ticket',
    ...(excludeCartItemId ? { id: { not: excludeCartItemId } } : {}),
  };
  const pendingCartItems = await prisma.cartItem.aggregate({
    _sum: { quantity: true },
    where: pendingWhere,
  });
  const pendingQty = pendingCartItems._sum.quantity ?? 0;

  if (event.maxTicketsPerUser !== null) {
    const totalAfter = existingTickets + pendingQty + input.quantity;
    if (totalAfter > event.maxTicketsPerUser) {
      throw codedError(
        `Exceeds max ${event.maxTicketsPerUser} ticket(s) per user for this event`,
        'MAX_TICKETS_EXCEEDED',
        409,
      );
    }
  }

  if (input.tickets.length !== input.quantity) {
    throw codedError(
      `tickets array length (${input.tickets.length}) must equal quantity (${input.quantity})`,
      'TICKETS_QUANTITY_MISMATCH',
      400,
    );
  }

  const allExtraIds = new Set<string>();
  for (const ticket of input.tickets) {
    for (const extraId of ticket.extras) {
      allExtraIds.add(extraId);
    }
  }

  if (allExtraIds.size > 0) {
    const extras = await prisma.ticketExtra.findMany({
      where: { id: { in: [...allExtraIds] } },
      select: { id: true, eventId: true, active: true, quantityTotal: true, quantitySold: true },
    });
    const extrasById = new Map(extras.map((e) => [e.id, e]));

    const extraCounts = new Map<string, number>();
    for (const ticket of input.tickets) {
      for (const extraId of ticket.extras) {
        extraCounts.set(extraId, (extraCounts.get(extraId) ?? 0) + 1);
      }
    }

    for (const [extraId, count] of extraCounts) {
      const extra = extrasById.get(extraId);
      if (!extra || extra.eventId !== input.eventId) {
        throw codedError(`Extra ${extraId} not found for this event`, 'EXTRA_NOT_FOUND', 404);
      }
      if (!extra.active) {
        throw codedError(`Extra ${extraId} is not active`, 'EXTRA_NOT_ACTIVE', 409);
      }
      if (extra.quantityTotal !== null && extra.quantityTotal - extra.quantitySold < count) {
        throw codedError(`Extra ${extraId} is sold out`, 'EXTRA_SOLD_OUT', 409);
      }
    }
  }

  return {
    kind: input.kind,
    event: { id: event.id, maxTicketsPerUser: event.maxTicketsPerUser },
    tier: {
      id: tier.id,
      priceCents: tier.priceCents,
      currency: tier.currency,
      requiresCar: tier.requiresCar,
    },
    variant: null,
  };
}

async function validateProductCartItem(
  input: CartItemInput,
  excludeCartItemId?: string,
): Promise<ValidatedCartItem> {
  const variantId = input.variantId;
  if (!variantId) {
    throw codedError('variantId required for product items', 'VARIANT_NOT_FOUND', 404);
  }

  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      priceCents: true,
      quantityTotal: true,
      quantitySold: true,
      active: true,
      product: {
        select: {
          id: true,
          status: true,
          currency: true,
          shippingFeeCents: true,
          allowShip: true,
          allowPickup: true,
          virtual: true,
        },
      },
    },
  });
  if (!variant) {
    throw codedError('Variant not found', 'VARIANT_NOT_FOUND', 404);
  }
  if (!variant.active || variant.product.status !== 'active') {
    throw codedError('Variant not available for sale', 'VARIANT_NOT_ACTIVE', 409);
  }
  void excludeCartItemId;

  if (!variant.product.virtual) {
    const available = variant.quantityTotal - variant.quantitySold;
    if (available < input.quantity) {
      throw codedError(`Only ${available} unit(s) remaining`, 'VARIANT_SOLD_OUT', 409);
    }
  } else if (input.quantity !== 1) {
    // Virtual products (e.g. garage spot) settle 1 GarageSpot per OrderItem.
    // Checkout creates a single OrderItem with the input quantity, so qty>1
    // would charge for N spots and only fulfill one. Force qty=1 at the gate.
    throw codedError(
      'produtos virtuais só podem ser comprados com quantidade 1',
      'VIRTUAL_QUANTITY_INVALID',
      422,
    );
  }

  return {
    kind: 'product',
    event: null,
    tier: null,
    variant: {
      id: variant.id,
      productId: variant.productId,
      priceCents: variant.priceCents,
      currency: variant.product.currency,
      shippingFeeCents: variant.product.shippingFeeCents,
      allowShip: variant.product.allowShip,
      allowPickup: variant.product.allowPickup,
      virtual: variant.product.virtual,
    },
  };
}
