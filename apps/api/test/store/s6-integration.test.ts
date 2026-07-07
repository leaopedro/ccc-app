import { prisma } from '@jdm/db';
import { adminStoreOrderDetailSchema } from '@jdm/shared/admin';
import { beginCheckoutResponseSchema } from '@jdm/shared/cart';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { AbacatePayUpstreamError } from '../../src/services/abacatepay/index.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakes, resetDatabase } from '../helpers.js';

const env = loadEnv();
const errorSchema = z.object({ error: z.string(), message: z.string().optional() });
const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const seedActiveProduct = async (opts?: {
  variantPriceCents?: number;
  quantityTotal?: number;
  quantitySold?: number;
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
      status: 'active',
      allowShip: opts?.shippingFeeCents != null,
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
      quantitySold: opts?.quantitySold ?? 0,
      attributes: { size: 'M' },
      active: true,
    },
  });
  return { product, variant };
};

const seedShippingAddress = (userId: string) =>
  prisma.shippingAddress.create({
    data: {
      userId,
      recipientName: 'Maria Santos',
      line1: 'Rua das Flores',
      number: '123',
      district: 'Centro',
      city: 'Curitiba',
      stateCode: 'PR',
      postalCode: '80000-000',
      phone: '41999999999',
      isDefault: true,
    },
  });

const addProductCartItem = (
  app: FastifyInstance,
  token: string,
  opts: { variantId: string; quantity?: number },
) =>
  app.inject({
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

describe('JDMA-367 store integration regression (S6.1)', () => {
  describe('product-only Pix end-to-end checkout', () => {
    let app: FastifyInstance;
    let abacatepay: FakeAbacatePay;

    beforeEach(async () => {
      await resetDatabase();
      ({ app, abacatepay } = await makeAppWithFakes());
    });

    afterEach(async () => {
      await app.close();
    });

    it('creates abacatepay billing for product cart, reserves variant, attaches shipping', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const address = await seedShippingAddress(user.id);
      const { variant } = await seedActiveProduct({
        variantPriceCents: 9000,
        quantityTotal: 5,
        shippingFeeCents: 1500,
      });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 2 });

      abacatepay.nextBilling = {
        id: 'pix_product_only',
        brCode: '00020126...productpix',
        amount: 19_500,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        status: 'PENDING',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'pix', shippingAddressId: address.id },
      });

      expect(res.statusCode).toBe(201);
      const body = beginCheckoutResponseSchema.parse(res.json());
      expect(body.provider).toBe('abacatepay');
      expect(body.brCode).toBe('00020126...productpix');
      expect(body.checkoutUrl).toBeNull();
      expect(body.providerRef).toBe('pix_product_only');
      expect(body.orderIds).toHaveLength(1);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.orderIds[0]! },
        include: { items: true },
      });
      expect(order.kind).toBe('product');
      expect(order.method).toBe('pix');
      expect(order.provider).toBe('abacatepay');
      expect(order.status).toBe('pending');
      expect(order.providerRef).toBe('pix_product_only');
      expect(order.shippingAddressId).toBe(address.id);
      expect(order.shippingCents).toBe(1500);
      expect(order.amountCents).toBe(21_300);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]!.kind).toBe('product');
      expect(order.items[0]!.variantId).toBe(variant.id);
      expect(order.items[0]!.quantity).toBe(2);

      const billingCall = abacatepay.calls.find((c) => c.method === 'createPixBilling');
      expect(billingCall).toBeDefined();
      const input = billingCall!.args[0] as {
        amountCents: number;
        metadata: Record<string, string>;
      };
      expect(input.amountCents).toBe(21_300);
      expect(input.metadata.cartId).toBe(body.checkoutId);
      expect(input.metadata.userId).toBe(user.id);

      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(2);

      const cart = await prisma.cart.findFirst({ where: { userId: user.id } });
      expect(cart!.status).toBe('checking_out');
    });

    it('rolls back variant reservation and reopens cart when abacatepay rejects', async () => {
      const { user } = await createUser({ verified: true });
      const token = bearer(env, user.id);
      const address = await seedShippingAddress(user.id);
      const { variant } = await seedActiveProduct({
        variantPriceCents: 9000,
        quantityTotal: 5,
        shippingFeeCents: 1500,
      });

      await addProductCartItem(app, token, { variantId: variant.id, quantity: 1 });

      abacatepay.nextBillingError = new AbacatePayUpstreamError(422, 'invalid', 'amount invalid');

      const res = await app.inject({
        method: 'POST',
        url: '/cart/checkout',
        headers: { authorization: token },
        payload: { paymentMethod: 'pix', shippingAddressId: address.id },
      });

      expect(res.statusCode).toBe(502);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('BadGateway');

      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(0);
      const cart = await prisma.cart.findFirst({ where: { userId: user.id } });
      expect(cart!.status).toBe('open');
      const orders = await prisma.order.findMany({ where: { userId: user.id } });
      expect(orders).toHaveLength(0);
    });
  });

  describe('refund webhook releases variant inventory', () => {
    let app: FastifyInstance;
    let stripe: FakeStripe;

    beforeEach(async () => {
      await resetDatabase();
      stripe = buildFakeStripe();
      app = await buildApp(loadEnv(), { stripe });
    });

    afterEach(async () => {
      await app.close();
    });

    it('partial refund on duplicate-ticket mixed order decrements variant.quantitySold', async () => {
      const { user } = await createUser({ verified: true });
      const event = await prisma.event.create({
        data: {
          slug: `e-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Evento Misto',
          description: 'desc',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          venueName: 'v',
          venueAddress: 'a',
          city: 'São Paulo',
          stateCode: 'SP',
          type: 'meeting',
          status: 'published',
          capacity: 10,
          maxTicketsPerUser: 1,
          publishedAt: new Date(),
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 10,
          quantitySold: 1,
          sortOrder: 0,
        },
      });
      const productType = await prisma.productType.create({
        data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
      });
      const product = await prisma.product.create({
        data: {
          slug: `p-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Camiseta JDM',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 9000,
          currency: 'BRL',
          status: 'active',
          allowShip: true,
          shippingFeeCents: 1500,
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'Preto — M',
          priceCents: 9000,
          quantityTotal: 10,
          quantitySold: 2,
          attributes: { size: 'M' },
          active: true,
        },
      });
      const cart = await prisma.cart.create({
        data: { userId: user.id, status: 'checking_out' },
      });
      const address = await prisma.shippingAddress.create({
        data: {
          userId: user.id,
          recipientName: 'Maria Santos',
          line1: 'Rua das Flores',
          number: '123',
          district: 'Centro',
          city: 'Curitiba',
          stateCode: 'PR',
          postalCode: '80000-000',
          phone: '41999999999',
          isDefault: true,
        },
      });
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          cartId: cart.id,
          kind: 'mixed',
          amountCents: 15_500,
          quantity: 2,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          shippingAddressId: address.id,
          shippingCents: 1500,
          fulfillmentMethod: 'ship',
          status: 'pending',
          expiresAt: new Date(Date.now() + 15 * 60_000),
          items: {
            create: [
              {
                kind: 'product',
                variantId: variant.id,
                quantity: 1,
                unitPriceCents: 9000,
                subtotalCents: 9000,
              },
              {
                kind: 'ticket',
                tierId: tier.id,
                eventId: event.id,
                quantity: 1,
                unitPriceCents: 5000,
                subtotalCents: 5000,
              },
            ],
          },
        },
      });

      // Buyer already holds a valid ticket for this event → settlement triggers
      // duplicate-ticket refund path which must release the variant reservation.
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });

      stripe.nextEvent = {
        id: 'evt_cart_dup_variant_refund',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_cart_dup_variant_refund',
            metadata: {
              cartId: cart.id,
              userId: user.id,
              orderIds: JSON.stringify([order.id]),
            },
          },
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(res.statusCode).toBe(200);

      const refundCalls = stripe.calls.filter((c) => c.kind === 'refund');
      expect(refundCalls).toHaveLength(1);
      const refundPayload = refundCalls[0]!.payload as { amountCents?: number };
      expect(refundPayload.amountCents).toBe(15_500);

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('refunded');

      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(1);

      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);

      const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
      expect(tickets).toHaveLength(1);
    });
  });

  describe('admin fulfillment guard for refunded orders', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      await resetDatabase();
      ({ app } = await makeAppWithFakes());
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects fulfillment update on refunded product orders with 409', async () => {
      const buyer = await createUser({ email: 'refunded@jdm.test', verified: true });
      const organizer = await createUser({
        email: 'org-refunded@jdm.test',
        verified: true,
        role: 'organizer',
      });
      const productType = await prisma.productType.create({
        data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
      });
      const product = await prisma.product.create({
        data: {
          slug: `p-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Camiseta JDM',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 9000,
          currency: 'BRL',
          status: 'active',
          allowShip: true,
          shippingFeeCents: 1500,
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'Preto — M',
          priceCents: 9000,
          quantityTotal: 5,
          quantitySold: 0,
          attributes: { size: 'M' },
          active: true,
        },
      });
      const address = await prisma.shippingAddress.create({
        data: {
          userId: buyer.user.id,
          recipientName: 'Cliente Teste',
          line1: 'Rua das Flores',
          number: '123',
          district: 'Centro',
          city: 'Curitiba',
          stateCode: 'PR',
          postalCode: '80000-000',
          isDefault: true,
        },
      });
      const order = await prisma.order.create({
        data: {
          userId: buyer.user.id,
          kind: 'product',
          amountCents: 10_500,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: 'pi_refunded_fixture',
          shippingAddressId: address.id,
          shippingCents: 1500,
          fulfillmentMethod: 'ship',
          fulfillmentStatus: 'unfulfilled',
          status: 'refunded',
          items: {
            create: {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 9000,
              subtotalCents: 9000,
            },
          },
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: {
          authorization: bearer(env, organizer.user.id, 'organizer'),
          'content-type': 'application/json',
        },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('Conflict');

      // Detail endpoint still surfaces the refunded order so ops can audit it.
      const detail = await app.inject({
        method: 'GET',
        url: `/admin/store/orders/${order.id}`,
        headers: { authorization: bearer(env, organizer.user.id, 'organizer') },
      });
      expect(detail.statusCode).toBe(200);
      const parsed = adminStoreOrderDetailSchema.parse(detail.json());
      expect(parsed.paymentStatus).toBe('refunded');
      expect(parsed.fulfillmentStatus).toBe('unfulfilled');
    });
  });

  describe('admin role guards on store mutation endpoints', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      await resetDatabase();
      ({ app } = await makeAppWithFakes());
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects staff role on POST /admin/store/products', async () => {
      const productType = await prisma.productType.create({ data: { name: 'Vestuário' } });
      const { user } = await createUser({
        email: 'staff-prod@jdm.test',
        verified: true,
        role: 'staff',
      });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/products',
        headers: {
          authorization: bearer(env, user.id, 'staff'),
          'content-type': 'application/json',
        },
        payload: {
          slug: 'camiseta-staff',
          title: 'Camiseta Staff',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 5000,
          currency: 'BRL',
          status: 'draft',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects unauthenticated requests on GET /admin/store/products', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/store/products' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects staff role on POST /admin/store/product-types', async () => {
      const { user } = await createUser({
        email: 'staff-pt@jdm.test',
        verified: true,
        role: 'staff',
      });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/product-types',
        headers: {
          authorization: bearer(env, user.id, 'staff'),
          'content-type': 'application/json',
        },
        payload: { name: 'Acessórios' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects staff role on POST /admin/store/collections', async () => {
      const { user } = await createUser({
        email: 'staff-col@jdm.test',
        verified: true,
        role: 'staff',
      });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/store/collections',
        headers: {
          authorization: bearer(env, user.id, 'staff'),
          'content-type': 'application/json',
        },
        payload: { slug: 'verao-2026', title: 'Verão 2026' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects staff role on POST /admin/store/products/:id/variants', async () => {
      const productType = await prisma.productType.create({
        data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
      });
      const product = await prisma.product.create({
        data: {
          slug: `p-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Camiseta',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 9000,
          currency: 'BRL',
          status: 'draft',
        },
      });
      const { user } = await createUser({
        email: 'staff-var@jdm.test',
        verified: true,
        role: 'staff',
      });
      const res = await app.inject({
        method: 'POST',
        url: `/admin/store/products/${product.id}/variants`,
        headers: {
          authorization: bearer(env, user.id, 'staff'),
          'content-type': 'application/json',
        },
        payload: {
          name: 'Padrão',
          priceCents: 9000,
          quantityTotal: 5,
          attributes: {},
          active: true,
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
