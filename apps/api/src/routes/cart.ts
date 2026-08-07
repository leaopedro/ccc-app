import { prisma } from '@ccc/db';
import {
  beginCheckoutRequestSchema,
  beginCheckoutResponseSchema,
  getCartResponseSchema,
  upsertCartItemRequestSchema,
  upsertCartItemResponseSchema,
  clearCartResponseSchema,
} from '@ccc/shared/cart';
import type { CartItemInput } from '@ccc/shared/cart';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { AbacatePayUpstreamError } from '../services/abacatepay/index.js';
import {
  loadCartForCheckout,
  reserveAndCreateOrders,
  rollbackCartCheckout,
} from '../services/cart/checkout.js';
import {
  CART_INCLUDE_FOR_SERIALIZE,
  computeAvailableFulfillmentMethods,
  computeItemAmount,
  evictStaleItems,
  findIncompatibleProducts,
  getActiveCart,
  getOrCreateCart,
  loadCartFulfillmentContext,
  serializeCart,
  validateCartItem,
} from '../services/cart/index.js';
import type { ValidatedCartItem } from '../services/cart/index.js';
import { withOrderIdParam } from '../services/cart/success-url.js';
import { ORDER_EXPIRY_MS } from '../services/orders/expire.js';
import { enforceProfileGate } from '../services/profile/gate.js';
import {
  EventPickupValidationError,
  validateEventPickupSelection,
} from '../services/store/event-pickup.js';
import { ensureStoreSettings } from '../services/store-settings.js';

type ExtraRow = {
  extraId: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
};

async function priceCartItemExtras(
  input: CartItemInput,
): Promise<
  { ok: true; extras: ExtraRow[] } | { ok: false; status: number; error: string; message: string }
> {
  const counts = new Map<string, number>();
  for (const ticket of input.tickets) {
    for (const extraId of ticket.extras) {
      counts.set(extraId, (counts.get(extraId) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return { ok: true, extras: [] };
  const extras = await prisma.ticketExtra.findMany({
    where: { id: { in: [...counts.keys()] } },
    select: { id: true, priceCents: true },
  });
  const priceMap = new Map(extras.map((e) => [e.id, e.priceCents]));
  const rows: ExtraRow[] = [];
  for (const [extraId, qty] of counts.entries()) {
    const unitPriceCents = priceMap.get(extraId);
    if (unitPriceCents === undefined) {
      return {
        ok: false,
        status: 409,
        error: 'ExtraNotFound',
        message: `Extra ${extraId} disappeared during pricing`,
      };
    }
    rows.push({
      extraId,
      quantity: qty,
      unitPriceCents,
      subtotalCents: unitPriceCents * qty,
    });
  }
  return { ok: true, extras: rows };
}

function mapValidationError(code: string | undefined): { error: string; status: number } {
  if (
    code === 'TIER_SOLD_OUT' ||
    code === 'MAX_TICKETS_EXCEEDED' ||
    code === 'EXTRA_SOLD_OUT' ||
    code === 'VARIANT_SOLD_OUT'
  ) {
    return { error: 'SoldOut', status: 409 };
  }
  if (code === 'VARIANT_NOT_ACTIVE') {
    return { error: 'Conflict', status: 409 };
  }
  if (code === 'TICKETS_QUANTITY_MISMATCH') {
    return { error: 'BadRequest', status: 400 };
  }
  if (code === 'VIRTUAL_QUANTITY_INVALID') {
    return { error: 'UnprocessableEntity', status: 422 };
  }
  return { error: 'NotFound', status: 404 };
}

function priceFromValidation(validated: ValidatedCartItem): {
  unitPriceCents: number;
  currency: string;
} {
  if (validated.kind === 'product') {
    return { unitPriceCents: validated.variant.priceCents, currency: validated.variant.currency };
  }
  return { unitPriceCents: validated.tier.priceCents, currency: validated.tier.currency };
}

async function storeDisabled(): Promise<boolean> {
  const settings = await ensureStoreSettings();
  return !settings.storeEnabled;
}

// eslint-disable-next-line @typescript-eslint/require-await
export const cartRoutes: FastifyPluginAsync = async (app) => {
  // GET /cart
  app.get('/cart', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const cart = await getActiveCart(sub);

    if (!cart) {
      return getCartResponseSchema.parse({
        cart: null,
        stockWarnings: [],
        evictedItems: [],
        flags: { cartV1: true },
      });
    }

    const evictedItems = await evictStaleItems(cart);

    const freshCart = evictedItems.length > 0 ? await getActiveCart(sub) : cart;
    const fulfillmentContext = await loadCartFulfillmentContext();

    return getCartResponseSchema.parse({
      cart: freshCart
        ? serializeCart(freshCart, fulfillmentContext, { devFeePercent: app.env.DEV_FEE_PERCENT })
        : null,
      stockWarnings: [],
      evictedItems,
      flags: { cartV1: true },
    });
  });

  // POST /cart/items
  app.post('/cart/items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const { item: input } = upsertCartItemRequestSchema.parse(request.body);

    let validated: ValidatedCartItem;
    try {
      validated = await validateCartItem(input, sub);
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number; code?: string };
      const status = e.statusCode ?? 400;
      const { error } = mapValidationError(e.code);
      return reply.status(status).send({ error, code: e.code, message: e.message });
    }

    // Virtual products (e.g. garage spot) bypass the storeDisabled gate: they
    // are not part of the physical merchandise queue and must remain purchasable
    // when the store is off (matches the /cart/checkout carve-out).
    if (validated.kind === 'product' && !validated.variant.virtual && (await storeDisabled())) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'store is currently disabled' });
    }

    const extrasResult = await priceCartItemExtras(input);
    if (!extrasResult.ok) {
      return reply.status(extrasResult.status).send({
        error: extrasResult.error,
        message: extrasResult.message,
      });
    }
    const extraRows = extrasResult.extras;
    const { unitPriceCents, currency } = priceFromValidation(validated);
    const amountCents = computeItemAmount(
      validated.kind === 'product'
        ? {
            variantPriceCents: unitPriceCents,
            shippingFeeCents: validated.variant.shippingFeeCents,
          }
        : { tierPriceCents: unitPriceCents },
      input.quantity,
      extraRows,
      validated.kind,
    );

    const cart = await getOrCreateCart(sub);
    const fulfillmentContext = await loadCartFulfillmentContext();

    // Virtual products (e.g. garage spot) carry allowShip=false/allowPickup=false
    // but never participate in pickup/ship logistics, so the compatibility check
    // would falsely flag every physical line as conflicting. Skip the check when
    // the candidate is virtual.
    if (validated.kind === 'product' && !validated.variant.virtual) {
      const conflicting = findIncompatibleProducts(
        cart.items,
        validated.variant.allowShip,
        validated.variant.allowPickup,
        fulfillmentContext,
      );
      if (conflicting.compatible === false) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          code: 'CART_INCOMPATIBLE_FULFILLMENT',
          message: 'Item nao compativel com os itens ja no carrinho.',
          conflictingItemIds: conflicting.conflictingItemIds,
        });
      }
    }

    const updatedCart = await prisma.$transaction(async (tx) => {
      const newItem = await tx.cartItem.create({
        data: {
          cartId: cart.id,
          eventId: validated.kind === 'product' ? null : (input.eventId ?? null),
          tierId: validated.kind === 'product' ? null : (input.tierId ?? null),
          variantId: validated.kind === 'product' ? validated.variant.id : null,
          source: input.source ?? 'purchase',
          kind: validated.kind,
          quantity: input.quantity,
          tickets: input.tickets as unknown as object,
          metadata: (input.metadata as unknown as object) ?? undefined,
          amountCents,
          currency,
        },
      });

      if (extraRows.length > 0) {
        await tx.cartItemExtra.createMany({
          data: extraRows.map((r) => ({
            cartItemId: newItem.id,
            extraId: r.extraId,
            quantity: r.quantity,
            unitPriceCents: r.unitPriceCents,
            subtotalCents: r.subtotalCents,
          })),
        });
      }

      return tx.cart.update({
        where: { id: cart.id },
        data: { version: { increment: 1 } },
        include: CART_INCLUDE_FOR_SERIALIZE,
      });
    });

    return upsertCartItemResponseSchema.parse({
      cart: serializeCart(updatedCart, fulfillmentContext, {
        devFeePercent: app.env.DEV_FEE_PERCENT,
      }),
    });
  });

  // PATCH /cart/items/:itemId
  app.patch<{ Params: { itemId: string } }>(
    '/cart/items/:itemId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { itemId } = request.params;
      const { item: input } = upsertCartItemRequestSchema.parse(request.body);

      const cart = await getActiveCart(sub);
      if (!cart) {
        return reply.status(404).send({ error: 'NotFound', message: 'no active cart' });
      }

      const existing = cart.items.find((i) => i.id === itemId);
      if (!existing) {
        return reply.status(404).send({ error: 'NotFound', message: 'cart item not found' });
      }

      let validated: ValidatedCartItem;
      try {
        validated = await validateCartItem(input, sub, itemId);
      } catch (err: unknown) {
        const e = err as Error & { statusCode?: number; code?: string };
        const status = e.statusCode ?? 400;
        const { error } = mapValidationError(e.code);
        return reply.status(status).send({ error, code: e.code, message: e.message });
      }

      // Virtual products (e.g. garage spot) bypass the storeDisabled gate: they
      // are not part of the physical merchandise queue and must remain editable
      // when the store is off (matches the /cart/checkout carve-out).
      if (validated.kind === 'product' && !validated.variant.virtual && (await storeDisabled())) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'store is currently disabled' });
      }

      const extraCounts = new Map<string, number>();
      for (const ticket of input.tickets) {
        for (const extraId of ticket.extras) {
          extraCounts.set(extraId, (extraCounts.get(extraId) ?? 0) + 1);
        }
      }

      const extraRows: {
        extraId: string;
        quantity: number;
        unitPriceCents: number;
        subtotalCents: number;
      }[] = [];
      if (extraCounts.size > 0) {
        const extras = await prisma.ticketExtra.findMany({
          where: { id: { in: [...extraCounts.keys()] } },
          select: { id: true, priceCents: true },
        });
        const priceMap = new Map(extras.map((e) => [e.id, e.priceCents]));
        for (const [extraId, qty] of extraCounts.entries()) {
          const unitPriceCents = priceMap.get(extraId);
          if (unitPriceCents === undefined) {
            return reply.status(409).send({
              error: 'ExtraNotFound',
              message: `Extra ${extraId} disappeared during pricing`,
            });
          }
          extraRows.push({
            extraId,
            quantity: qty,
            unitPriceCents,
            subtotalCents: unitPriceCents * qty,
          });
        }
      }

      const { unitPriceCents, currency } = priceFromValidation(validated);
      const amountCents = computeItemAmount(
        validated.kind === 'product'
          ? {
              variantPriceCents: unitPriceCents,
              shippingFeeCents: validated.variant.shippingFeeCents,
            }
          : { tierPriceCents: unitPriceCents },
        input.quantity,
        extraRows,
        validated.kind,
      );

      const fulfillmentContext = await loadCartFulfillmentContext();

      // Virtual products (e.g. garage spot) carry allowShip=false/allowPickup=false
      // but never participate in pickup/ship logistics, so the compatibility check
      // would falsely flag every physical line as conflicting. Skip the check when
      // the candidate is virtual.
      if (validated.kind === 'product' && !validated.variant.virtual) {
        const conflicting = findIncompatibleProducts(
          cart.items,
          validated.variant.allowShip,
          validated.variant.allowPickup,
          fulfillmentContext,
          { excludeCartItemId: itemId },
        );
        if (conflicting.compatible === false) {
          return reply.status(422).send({
            error: 'UnprocessableEntity',
            code: 'CART_INCOMPATIBLE_FULFILLMENT',
            message: 'Item nao compativel com os itens ja no carrinho.',
            conflictingItemIds: conflicting.conflictingItemIds,
          });
        }
      }

      const updatedCart = await prisma.$transaction(async (tx) => {
        await tx.cartItemExtra.deleteMany({ where: { cartItemId: itemId } });

        await tx.cartItem.update({
          where: { id: itemId },
          data: {
            eventId: validated.kind === 'product' ? null : (input.eventId ?? null),
            tierId: validated.kind === 'product' ? null : (input.tierId ?? null),
            variantId: validated.kind === 'product' ? validated.variant.id : null,
            source: input.source ?? 'purchase',
            kind: validated.kind,
            quantity: input.quantity,
            tickets: input.tickets as unknown as object,
            metadata: (input.metadata as unknown as object) ?? undefined,
            amountCents,
            currency,
          },
        });

        if (extraRows.length > 0) {
          await tx.cartItemExtra.createMany({
            data: extraRows.map((r) => ({
              cartItemId: itemId,
              extraId: r.extraId,
              quantity: r.quantity,
              unitPriceCents: r.unitPriceCents,
              subtotalCents: r.subtotalCents,
            })),
          });
        }

        return tx.cart.update({
          where: { id: cart.id },
          data: { version: { increment: 1 } },
          include: CART_INCLUDE_FOR_SERIALIZE,
        });
      });

      return upsertCartItemResponseSchema.parse({
        cart: serializeCart(updatedCart, fulfillmentContext, {
          devFeePercent: app.env.DEV_FEE_PERCENT,
        }),
      });
    },
  );

  // DELETE /cart/items/:itemId
  app.delete<{ Params: { itemId: string } }>(
    '/cart/items/:itemId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const { itemId } = request.params;

      const cart = await getActiveCart(sub);
      if (!cart) {
        return reply.status(404).send({ error: 'NotFound', message: 'no active cart' });
      }

      const item = cart.items.find((i) => i.id === itemId);
      if (!item) {
        return reply.status(404).send({ error: 'NotFound', message: 'cart item not found' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.cartItemExtra.deleteMany({ where: { cartItemId: itemId } });
        await tx.cartItem.delete({ where: { id: itemId } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { version: { increment: 1 } },
        });
      });

      return clearCartResponseSchema.parse({ ok: true });
    },
  );

  // DELETE /cart
  app.delete('/cart', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);

    const cart = await getActiveCart(sub);
    if (cart) {
      await prisma.cart.delete({ where: { id: cart.id } });
      console.log('cart.clear', { userId: sub, cartId: cart.id });
    }

    return clearCartResponseSchema.parse({ ok: true });
  });

  // POST /cart/checkout
  app.post('/cart/checkout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);

    // Gate before anything mutates: below this line the cart flips to
    // `checking_out` and tiers get reserved.
    const gated = await enforceProfileGate(app, sub, reply, 'checkout');
    if (gated) return gated;

    const parsed = beginCheckoutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    const input = parsed.data;

    if (input.paymentMethod === 'pix' && !app.abacatepay) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'pix provider not configured' });
    }

    const cartResult = await loadCartForCheckout(sub);
    if (!cartResult.ok) {
      return reply.status(cartResult.status).send({
        error: cartResult.error,
        message: cartResult.message,
      });
    }
    const { cart } = cartResult;

    if (
      cart.items.some(
        (item) => item.kind === 'product' && item.variant && !item.variant.product.virtual,
      ) &&
      (await storeDisabled())
    ) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'store is currently disabled' });
    }

    if (cart.status !== 'open') {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'cart is already checking out',
      });
    }

    if (input.pickupEventId && input.shippingAddressId) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        message: 'pickupEventId: não combine retirada em evento com endereço de entrega',
      });
    }

    const fulfillmentContext = await loadCartFulfillmentContext();
    const hasPhysicalProductItems = cart.items.some(
      (item) => item.kind === 'product' && item.variant && !item.variant.product.virtual,
    );
    const availableMethods = computeAvailableFulfillmentMethods(cart.items, fulfillmentContext);
    let resolvedFulfillmentMethod: 'pickup' | 'ship' | null = null;

    if (hasPhysicalProductItems) {
      if (availableMethods.length === 0) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          code: 'CART_INCOMPATIBLE_FULFILLMENT',
          message: 'Itens no carrinho não compartilham nenhum método de entrega.',
        });
      }
      const physicalAvailable = availableMethods.filter(
        (m): m is 'pickup' | 'ship' => m === 'pickup' || m === 'ship',
      );
      const requestedRaw =
        input.fulfillmentMethod ?? (physicalAvailable.length === 1 ? physicalAvailable[0] : null);
      const requested = requestedRaw === 'pickup' || requestedRaw === 'ship' ? requestedRaw : null;
      if (!requested) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          code: 'FULFILLMENT_METHOD_REQUIRED',
          message: 'fulfillmentMethod: selecione retirada ou entrega.',
        });
      }
      if (!physicalAvailable.includes(requested)) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          code: 'FULFILLMENT_METHOD_UNAVAILABLE',
          message: 'fulfillmentMethod: método indisponível para os itens deste carrinho.',
        });
      }
      resolvedFulfillmentMethod = requested;
    }

    let pickupEventIdToUse: string | null = null;
    if (resolvedFulfillmentMethod === 'pickup') {
      if (!input.pickupEventId) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          message: 'pickupEventId: obrigatório para retirada no evento.',
        });
      }
      try {
        await validateEventPickupSelection(sub, input.pickupEventId, cart);
      } catch (err) {
        if (err instanceof EventPickupValidationError) {
          return reply.status(err.statusCode).send({
            error: 'UnprocessableEntity',
            message: `pickupEventId: ${err.message}`,
          });
        }
        throw err;
      }
      pickupEventIdToUse = input.pickupEventId;
    }

    const requiresShipping =
      resolvedFulfillmentMethod === 'ship' &&
      cart.items.some(
        (item) =>
          item.kind === 'product' &&
          item.variant &&
          !item.variant.product.virtual &&
          (item.variant.product.shippingFeeCents ?? 0) > 0,
      );
    let shippingAddressId: string | null = null;

    if (requiresShipping) {
      const shippingAddress = input.shippingAddressId
        ? await prisma.shippingAddress.findFirst({
            where: { id: input.shippingAddressId, userId: sub },
            select: { id: true },
          })
        : await prisma.shippingAddress.findFirst({
            where: { userId: sub },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          });
      if (!shippingAddress) {
        return reply.status(input.shippingAddressId ? 404 : 422).send({
          error: input.shippingAddressId ? 'NotFound' : 'UnprocessableEntity',
          message: input.shippingAddressId
            ? 'shipping address not found'
            : 'shippingAddressId: endereço de entrega é obrigatório para produtos físicos',
        });
      }
      shippingAddressId = shippingAddress.id;
    }

    const reserveResult = await reserveAndCreateOrders(cart, sub, {
      method: input.paymentMethod,
      shippingAddressId,
      pickupEventId: pickupEventIdToUse,
      fulfillmentMethod: resolvedFulfillmentMethod,
      devFeePercent: app.env.DEV_FEE_PERCENT,
    });
    if (!reserveResult.ok) {
      return reply.status(reserveResult.status).send({
        error: reserveResult.error,
        message: reserveResult.message,
        ...(reserveResult.code ? { code: reserveResult.code } : {}),
      });
    }
    const { data } = reserveResult;

    for (const ref of data.expiredProviderRefs) {
      app.stripe.cancelPaymentIntent(ref).catch((cancelErr) => {
        request.log.warn({ err: cancelErr, providerRef: ref }, 'cart checkout: PI cancel failed');
      });
    }

    if (input.paymentMethod === 'pix') {
      // Derive label flags from cart items, not Order.kind: a multi-line cart
      // is a single Order with kind='mixed' (see reserveAndCreateOrders), which
      // would otherwise hide ticket/product mix from this prefix logic.
      const hasTicketOrder = cart.items.some(
        (item) => item.kind === 'ticket' || item.kind === 'extras_only',
      );
      const hasProductOrder = cart.items.some((item) => item.kind === 'product');
      const labels = data.orders.map((o) => o.description);
      const prefix =
        hasTicketOrder && hasProductOrder ? 'Pedido' : hasProductOrder ? 'Loja' : 'Ingressos';
      const description = `${prefix} ${labels.join(' + ')}`;

      try {
        const billing = await app.abacatepay!.createPixBilling({
          amountCents: data.totalAmountCents,
          description,
          metadata: {
            cartId: cart.id,
            userId: sub,
            orderIds: JSON.stringify(data.orders.map((o) => o.id)),
            orderKinds: JSON.stringify(data.orders.map((o) => o.kind)),
            hasShippableItems: requiresShipping ? 'true' : 'false',
            ...(shippingAddressId ? { shippingAddressId } : {}),
          },
        });

        await prisma.order.update({
          where: { id: data.orders[0]!.id },
          data: { providerRef: billing.id, brCode: billing.brCode },
        });

        const updatedCart = await prisma.cart.findUniqueOrThrow({
          where: { id: cart.id },
          include: CART_INCLUDE_FOR_SERIALIZE,
        });

        return reply.status(201).send(
          beginCheckoutResponseSchema.parse({
            checkoutId: cart.id,
            status: 'pending',
            cart: serializeCart(updatedCart, fulfillmentContext, {
              devFeePercent: app.env.DEV_FEE_PERCENT,
            }),
            orderIds: data.orders.map((o) => o.id),
            provider: 'abacatepay',
            providerRef: billing.id,
            clientSecret: null,
            checkoutUrl: null,
            brCode: billing.brCode,
            reservationExpiresAt: new Date(Date.now() + ORDER_EXPIRY_MS).toISOString(),
          }),
        );
      } catch (err) {
        await rollbackCartCheckout(cart.id, data.orders);
        if (err instanceof AbacatePayUpstreamError && err.status >= 400 && err.status < 500) {
          request.log.warn(
            { err, cartId: cart.id, status: err.status },
            'cart checkout: AbacatePay rejected pix billing request',
          );
          return reply.status(502).send({
            error: 'BadGateway',
            message: 'pix provider rejected the request',
          });
        }
        throw err;
      }
    }

    const STRIPE_MIN_SESSION_MS = 30 * 60 * 1000;
    const sessionExpiryMs = Math.max(ORDER_EXPIRY_MS, STRIPE_MIN_SESSION_MS);
    const expiresAtUnix = Math.floor((Date.now() + sessionExpiryMs) / 1000);

    const productName = data.orders.map((o) => o.description).join(' + ');

    const baseSuccessUrl = input.successUrl ?? 'https://app.casacarclub.com.br/checkout/success';
    const cancelUrl = input.cancelUrl ?? 'https://app.casacarclub.com.br/checkout/cancel';

    const firstOrderId = data.orders[0]?.id;
    const successUrl = firstOrderId
      ? withOrderIdParam(baseSuccessUrl, firstOrderId)
      : baseSuccessUrl;

    try {
      const session = await app.stripe.createCheckoutSession({
        amountCents: data.totalAmountCents,
        currency: data.currency,
        productName,
        idempotencyKey: `cart_checkout_${cart.id}_v${cart.version}`,
        metadata: {
          cartId: cart.id,
          userId: sub,
          orderIds: JSON.stringify(data.orders.map((o) => o.id)),
          orderKinds: JSON.stringify(data.orders.map((o) => o.kind)),
          hasShippableItems: requiresShipping ? 'true' : 'false',
          ...(shippingAddressId ? { shippingAddressId } : {}),
        },
        successUrl,
        cancelUrl,
        expiresAt: expiresAtUnix,
      });

      if (session.paymentIntentId) {
        await prisma.order.updateMany({
          where: { cartId: cart.id, status: 'pending' },
          data: { providerRef: null },
        });
        await prisma.order.update({
          where: { id: data.orders[0]!.id },
          data: { providerRef: session.paymentIntentId },
        });
      }

      const updatedCart = await prisma.cart.findUniqueOrThrow({
        where: { id: cart.id },
        include: CART_INCLUDE_FOR_SERIALIZE,
      });

      const reservationExpiresAt = new Date(Date.now() + ORDER_EXPIRY_MS);

      return reply.status(201).send(
        beginCheckoutResponseSchema.parse({
          checkoutId: cart.id,
          status: 'pending',
          cart: serializeCart(updatedCart, fulfillmentContext, {
            devFeePercent: app.env.DEV_FEE_PERCENT,
          }),
          orderIds: data.orders.map((o) => o.id),
          provider: 'stripe',
          providerRef: session.paymentIntentId,
          clientSecret: null,
          checkoutUrl: session.url,
          brCode: null,
          reservationExpiresAt: reservationExpiresAt.toISOString(),
        }),
      );
    } catch (err) {
      await rollbackCartCheckout(cart.id, data.orders);
      throw err;
    }
  });
};
