import { prisma } from '@jdm/db';
import {
  beginCheckoutResponseSchema,
  getCartResponseSchema,
  upsertCartItemResponseSchema,
} from '@jdm/shared/cart';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();
const errorSchema = z.object({ error: z.string(), message: z.string().optional() });

const seedPublishedEvent = async (opts?: { priceCents?: number; quantityTotal?: number }) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento Teste',
      description: 'Descrição',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 100,
      maxTicketsPerUser: 5,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: opts?.priceCents ?? 5000,
      currency: 'BRL',
      quantityTotal: opts?.quantityTotal ?? 50,
      quantitySold: 0,
    },
  });
  return { event, tier };
};

const seedActiveProduct = async (opts?: {
  variantPriceCents?: number;
  quantityTotal?: number;
  active?: boolean;
  productStatus?: 'draft' | 'active' | 'archived';
  allowPickup?: boolean;
  allowShip?: boolean;
  shippingFeeCents?: number | null;
}) => {
  const productType = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'Algodão premium',
      productTypeId: productType.id,
      basePriceCents: opts?.variantPriceCents ?? 9000,
      currency: 'BRL',
      status: opts?.productStatus ?? 'active',
      allowPickup: opts?.allowPickup ?? false,
      allowShip: opts?.allowShip !== undefined ? opts.allowShip : true,
      ...(opts?.shippingFeeCents !== undefined ? { shippingFeeCents: opts.shippingFeeCents } : {}),
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Preto — M',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: opts?.variantPriceCents ?? 9000,
      quantityTotal: opts?.quantityTotal ?? 20,
      quantitySold: 0,
      attributes: { size: 'M', color: 'Preto' },
      active: opts?.active ?? true,
    },
  });
  return { product, variant };
};

const seedShippingAddress = async (userId: string) =>
  prisma.shippingAddress.create({
    data: {
      userId,
      recipientName: 'Maria Santos',
      line1: 'Rua das Flores',
      line2: 'Apto 10',
      number: '123',
      district: 'Centro',
      city: 'Curitiba',
      stateCode: 'PR',
      postalCode: '80000-000',
      phone: '41999999999',
      isDefault: true,
    },
  });

const disableStore = async () => {
  await prisma.storeSettings.upsert({
    where: { id: 'store_default' },
    update: { storeEnabled: false },
    create: { id: 'store_default', storeEnabled: false },
  });
};

const enableEventPickup = async () => {
  await prisma.storeSettings.upsert({
    where: { id: 'store_default' },
    update: { eventPickupEnabled: true },
    create: { id: 'store_default', eventPickupEnabled: true },
  });
};

const addProductCartItem = async (
  app: FastifyInstance,
  token: string,
  opts: { variantId: string; quantity?: number },
) => {
  const res = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: token },
    payload: {
      item: {
        kind: 'product',
        variantId: opts.variantId,
        quantity: opts.quantity ?? 1,
      },
    },
  });
  return res;
};

const addTicketCartItem = async (
  app: FastifyInstance,
  token: string,
  opts: { eventId: string; tierId: string; quantity?: number },
) => {
  const tickets = Array.from({ length: opts.quantity ?? 1 }, () => ({ extras: [] as string[] }));
  const res = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: token },
    payload: {
      item: {
        kind: 'ticket',
        eventId: opts.eventId,
        tierId: opts.tierId,
        quantity: opts.quantity ?? 1,
        tickets,
      },
    },
  });
  return res;
};

describe('cart product lines (JDMA-345)', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /cart/items kind=product', () => {
    it('adds a product line and serializes product fields', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { product, variant } = await seedActiveProduct({ variantPriceCents: 9000 });

      const res = await addProductCartItem(app, token, { variantId: variant.id, quantity: 2 });

      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.items).toHaveLength(1);
      const item = body.cart.items[0]!;
      expect(item.kind).toBe('product');
      expect(item.eventId).toBeNull();
      expect(item.tierId).toBeNull();
      expect(item.variantId).toBe(variant.id);
      expect(item.tickets).toEqual([]);
      expect(item.amountCents).toBe(18_000);
      expect(item.product).not.toBeNull();
      expect(item.product!.productId).toBe(product.id);
      expect(item.product!.variantId).toBe(variant.id);
      expect(item.product!.unitPriceCents).toBe(9000);
      expect(body.cart.totals.productsSubtotalCents).toBe(18_000);
      expect(body.cart.totals.amountCents).toBe(19_800);
    });

    it('rejects product items with eventId/tierId set', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct();
      const { event, tier } = await seedPublishedEvent();

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: token },
        payload: {
          item: {
            kind: 'product',
            variantId: variant.id,
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
          },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects ticket items missing tickets array', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { event, tier } = await seedPublishedEvent();

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: token },
        payload: {
          item: {
            kind: 'ticket',
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            tickets: [],
          },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects when variant inactive', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ active: false });

      const res = await addProductCartItem(app, token, { variantId: variant.id });
      expect(res.statusCode).toBe(409);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('Conflict');
    });

    it('rejects when variant lacks stock', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ quantityTotal: 1 });

      const res = await addProductCartItem(app, token, { variantId: variant.id, quantity: 5 });
      expect(res.statusCode).toBe(409);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('SoldOut');
    });

    it('rejects new product cart items when the store killswitch is off', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct();
      await disableStore();

      const res = await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });
      expect(res.statusCode).toBe(503);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('ServiceUnavailable');
    });

    it('GET /cart evicts items whose variant became inactive', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct();
      await addProductCartItem(app, token, { variantId: variant.id });

      await prisma.variant.update({ where: { id: variant.id }, data: { active: false } });

      const res = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: token },
      });
      expect(res.statusCode).toBe(200);
      const body = getCartResponseSchema.parse(res.json());
      expect(body.evictedItems.map((e) => e.reason)).toContain('variant_inactive');
    });
  });

  describe('POST /cart/checkout for product cart', () => {
    it('rejects event pickup when the method is disabled globally', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ allowPickup: true });
      const { event, tier } = await seedPublishedEvent();

      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', fulfillmentMethod: 'pickup', pickupEventId: event.id },
      });

      expect(res.statusCode).toBe(422);
      const body = z
        .object({ error: z.string(), code: z.string().optional(), message: z.string().optional() })
        .parse(res.json());
      expect(body.code).toBe('FULFILLMENT_METHOD_UNAVAILABLE');
    });

    it('rejects event pickup when no eligible ticket exists', async () => {
      await enableEventPickup();
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ allowPickup: true });
      const { event } = await seedPublishedEvent();

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', fulfillmentMethod: 'pickup', pickupEventId: event.id },
      });

      expect(res.statusCode).toBe(422);
      const body = errorSchema.parse(res.json());
      expect(body.message).toContain('pickupEventId');
      expect(body.message).toContain('eligible ticket');
    });

    it('accepts event pickup when the user already has a valid ticket', async () => {
      await enableEventPickup();
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ allowPickup: true });
      const { event, tier } = await seedPublishedEvent();

      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', fulfillmentMethod: 'pickup', pickupEventId: event.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        select: { pickupEventId: true, pickupTicketId: true },
      });
      expect(order.pickupEventId).toBe(event.id);
      expect(order.pickupTicketId).toBeNull();
    });

    it('accepts event pickup when the cart also buys a ticket for that event', async () => {
      await enableEventPickup();
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ allowPickup: true });
      const { event, tier } = await seedPublishedEvent({ priceCents: 4000 });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });
      await addTicketCartItem(app, token, { eventId: event.id, tierId: tier.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', fulfillmentMethod: 'pickup', pickupEventId: event.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      const productOrder = await prisma.order.findFirstOrThrow({
        where: { id: { in: body.orderIds }, kind: 'mixed' },
        select: { pickupEventId: true, pickupTicketId: true },
      });
      expect(productOrder.pickupEventId).toBe(event.id);
      expect(productOrder.pickupTicketId).toBeNull();
    });

    it('dual-method product can be purchased for pickup without a shipping address', async () => {
      await enableEventPickup();
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({
        allowPickup: true,
        allowShip: true,
        shippingFeeCents: 1500,
      });
      const { event, tier } = await seedPublishedEvent();
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', fulfillmentMethod: 'pickup', pickupEventId: event.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        select: { pickupEventId: true, fulfillmentMethod: true },
      });
      expect(order.pickupEventId).toBe(event.id);
      expect(order.fulfillmentMethod).toBe('pickup');
    });

    it('product-only checkout reserves variant and writes OrderItem', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { product, variant } = await seedActiveProduct({
        variantPriceCents: 9000,
        quantityTotal: 5,
      });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 2 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.orderIds).toHaveLength(1);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      expect(order.kind).toBe('product');
      expect(order.eventId).toBeNull();
      expect(order.tierId).toBeNull();
      expect(order.amountCents).toBe(19_800);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]!.kind).toBe('product');
      expect(order.items[0]!.variantId).toBe(variant.id);
      expect(order.items[0]!.quantity).toBe(2);
      expect(order.items[0]!.unitPriceCents).toBe(9000);
      expect(order.items[0]!.subtotalCents).toBe(18_000);

      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(2);

      const sessionCall = stripe.calls.find((c) => c.kind === 'createCheckoutSession');
      expect(sessionCall).toBeDefined();
      const payload = sessionCall!.payload as { productName: string };
      expect(payload.productName).toContain(product.title);
    });

    it('requires shippingAddressId for shippable product carts', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ shippingFeeCents: 1500 });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });

      expect(res.statusCode).toBe(422);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('UnprocessableEntity');
    });

    it('falls back to the default shipping address for shippable product carts when the client omits shippingAddressId', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const address = await seedShippingAddress(user.id);
      const { variant } = await seedActiveProduct({ shippingFeeCents: 1500 });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderIds[0]! } });
      expect(order.shippingAddressId).toBe(address.id);
      expect(order.shippingCents).toBe(1500);
    });

    it('adds shipping fee and fulfillment fields for shippable product checkout', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const address = await seedShippingAddress(user.id);
      const { variant } = await seedActiveProduct({
        variantPriceCents: 9000,
        shippingFeeCents: 1500,
      });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 2 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', shippingAddressId: address.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.cart.totals.shippingSubtotalCents).toBe(1500);
      expect(body.cart.totals.amountCents).toBe(21_300);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      expect(order.amountCents).toBe(21_300);
      expect(order.shippingCents).toBe(1500);
      expect(order.shippingAddressId).toBe(address.id);
      expect(order.fulfillmentMethod).toBe('ship');
      expect(order.items[0]!.subtotalCents).toBe(18_000);

      const sessionCall = stripe.calls.find((c) => c.kind === 'createCheckoutSession');
      expect(sessionCall).toBeDefined();
      const payload = sessionCall!.payload as {
        metadata: Record<string, string>;
      };
      expect(payload.metadata.shippingAddressId).toBe(address.id);
      expect(payload.metadata.hasShippableItems).toBe('true');
    });

    it('ticket-only checkout still writes ticket OrderItem rows', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { event, tier } = await seedPublishedEvent({ priceCents: 5000 });

      await addTicketCartItem(app, token, { eventId: event.id, tierId: tier.id, quantity: 2 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      expect(order.kind).toBe('ticket');
      expect(order.items).toHaveLength(1);
      expect(order.items[0]!.kind).toBe('ticket');
      expect(order.items[0]!.tierId).toBe(tier.id);
      expect(order.items[0]!.quantity).toBe(2);
      expect(order.items[0]!.unitPriceCents).toBe(5000);
      expect(order.items[0]!.subtotalCents).toBe(10_000);
    });

    it('ticket-only checkout still works when the store killswitch is off', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { event, tier } = await seedPublishedEvent({ priceCents: 5000 });
      await disableStore();

      await addTicketCartItem(app, token, { eventId: event.id, tierId: tier.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.orderIds).toHaveLength(1);
    });

    it('mixed cart groups ticket and product items into a single mixed order', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { event, tier } = await seedPublishedEvent({ priceCents: 4000 });
      const { variant } = await seedActiveProduct({ variantPriceCents: 7000 });

      await addTicketCartItem(app, token, { eventId: event.id, tierId: tier.id });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 3 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.orderIds).toHaveLength(1);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      expect(order.kind).toBe('mixed');
      // Mixed order does not pin Order.eventId/tierId; ticket scoping moves to OrderItem
      expect(order.eventId).toBeNull();
      expect(order.tierId).toBeNull();
      expect(order.amountCents).toBe(27_500);
      expect(order.items).toHaveLength(2);

      const ticketItem = order.items.find((i) => i.kind === 'ticket')!;
      const productItem = order.items.find((i) => i.kind === 'product')!;
      expect(ticketItem.eventId).toBe(event.id);
      expect(ticketItem.tierId).toBe(tier.id);
      expect(ticketItem.quantity).toBe(1);
      expect(ticketItem.subtotalCents).toBe(4000);

      expect(productItem.variantId).toBe(variant.id);
      expect(productItem.quantity).toBe(3);
      expect(productItem.subtotalCents).toBe(21_000);

      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(tierAfter.quantitySold).toBe(1);
      expect(variantAfter.quantitySold).toBe(3);
    });

    it('mixed cart attaches shipping to the single grouped order, scoped to product fulfillment', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const address = await seedShippingAddress(user.id);
      const { event, tier } = await seedPublishedEvent({ priceCents: 4000 });
      const { variant } = await seedActiveProduct({
        variantPriceCents: 7000,
        shippingFeeCents: 1200,
      });

      await addTicketCartItem(app, token, { eventId: event.id, tierId: tier.id });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', shippingAddressId: address.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.cart.totals.shippingSubtotalCents).toBe(1200);
      expect(body.cart.totals.amountCents).toBe(13_300);
      expect(body.orderIds).toHaveLength(1);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      expect(order.kind).toBe('mixed');
      // The cart has at least one shippable item, so the grouped order is 'ship' for the address
      expect(order.shippingCents).toBe(1200);
      expect(order.shippingAddressId).toBe(address.id);
      expect(order.fulfillmentMethod).toBe('ship');
      expect(order.amountCents).toBe(13_300);

      const ticketItem = order.items.find((i) => i.kind === 'ticket')!;
      const productItem = order.items.find((i) => i.kind === 'product')!;
      expect(ticketItem.subtotalCents).toBe(4000);
      expect(productItem.variantId).toBe(variant.id);
      expect(productItem.subtotalCents).toBe(7000);
    });

    it('charges only the most expensive shipping fee on the single grouped order', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const address = await seedShippingAddress(user.id);
      const first = await seedActiveProduct({
        variantPriceCents: 16_990,
        shippingFeeCents: 2_500,
      });
      const second = await seedActiveProduct({
        variantPriceCents: 7_990,
        shippingFeeCents: 900,
      });

      await addProductCartItem(app, token, { variantId: first.variant.id, quantity: 1 });
      await addProductCartItem(app, token, { variantId: second.variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', shippingAddressId: address.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.cart.totals.productsSubtotalCents).toBe(24_980);
      expect(body.cart.totals.shippingSubtotalCents).toBe(2_500);
      expect(body.cart.totals.amountCents).toBe(29_978);
      expect(body.orderIds).toHaveLength(1);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      // Multi-line carts always collapse to kind='mixed' so settlement reads
      // scope from OrderItem rows; a multi-product cart has two product
      // OrderItems and is no longer treated as a homogeneous 'product' Order.
      expect(order.kind).toBe('mixed');
      expect(order.shippingCents).toBe(2_500);
      expect(order.shippingAddressId).toBe(address.id);
      expect(order.fulfillmentMethod).toBe('ship');
      expect(order.amountCents).toBe(29_978);

      expect(order.items).toHaveLength(2);
      expect(order.items.map((item) => item.subtotalCents).sort((a, b) => a - b)).toEqual([
        7_990, 16_990,
      ]);
      expect(
        order.items.every(
          (item) => item.variantId === first.variant.id || item.variantId === second.variant.id,
        ),
      ).toBe(true);
    });

    it('rolls back variant reservation when Stripe session fails', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ quantityTotal: 5 });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 2 });

      stripe.createCheckoutSession = () => {
        throw new Error('Stripe unavailable');
      };

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(500);

      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(0);
      const cart = await prisma.cart.findFirst({ where: { userId: user.id } });
      expect(cart!.status).toBe('open');
    });

    it('blocks product checkout when the store killswitch is off', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ quantityTotal: 5 });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 2 });
      await disableStore();

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(503);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('ServiceUnavailable');

      const orders = await prisma.order.findMany({ where: { userId: user.id } });
      expect(orders).toHaveLength(0);
      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(0);
    });

    it('blocks adding a pickup-only product to a cart with a ship-only product', async () => {
      await enableEventPickup();
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant: shipOnly } = await seedActiveProduct({
        allowShip: true,
        allowPickup: false,
        shippingFeeCents: 1500,
      });
      const { variant: pickupOnly } = await seedActiveProduct({
        allowShip: false,
        allowPickup: true,
      });

      const okRes = await addProductCartItem(app, token, { variantId: shipOnly.id, quantity: 1 });
      expect(okRes.statusCode).toBe(200);

      const conflictRes = await addProductCartItem(app, token, {
        variantId: pickupOnly.id,
        quantity: 1,
      });
      expect(conflictRes.statusCode).toBe(422);
      const body = z
        .object({
          error: z.string(),
          code: z.string().optional(),
          conflictingItemIds: z.array(z.string()).optional(),
        })
        .parse(conflictRes.json());
      expect(body.code).toBe('CART_INCOMPATIBLE_FULFILLMENT');
      expect(body.conflictingItemIds?.length).toBe(1);
    });

    it('exposes availableFulfillmentMethods on the cart for a dual-method product', async () => {
      await enableEventPickup();
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({
        allowShip: true,
        allowPickup: true,
        shippingFeeCents: 1500,
      });
      const res = await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });
      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.availableFulfillmentMethods.sort()).toEqual(['pickup', 'ship']);
    });

    it('rejects checkout with fulfillmentMethod not in availableFulfillmentMethods', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({
        allowShip: true,
        allowPickup: false,
        shippingFeeCents: 1500,
      });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card', fulfillmentMethod: 'pickup' },
      });
      expect(res.statusCode).toBe(422);
      const body = z.object({ error: z.string(), code: z.string().optional() }).parse(res.json());
      expect(body.code).toBe('FULFILLMENT_METHOD_UNAVAILABLE');
    });

    it('blocks oversell with concurrent variant checkout', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const { variant } = await seedActiveProduct({ quantityTotal: 1 });
      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      await prisma.variant.update({
        where: { id: variant.id },
        data: { quantitySold: 1 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'card' },
      });
      expect(res.statusCode).toBe(409);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('Conflict');

      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(1);
    });
  });
});
