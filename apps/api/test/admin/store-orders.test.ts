import { prisma } from '@ccc/db';
import { adminStoreOrderDetailSchema, adminStoreOrderListResponseSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const ensureProductType = async () =>
  prisma.productType.upsert({
    where: { name: 'Vestuário' },
    update: {},
    create: { name: 'Vestuário' },
  });

const seedProduct = async (slug: string) => {
  const productType = await ensureProductType();
  return prisma.product.create({
    data: {
      slug,
      title: `Produto ${slug}`,
      description: 'Descrição',
      basePriceCents: 5000,
      productTypeId: productType.id,
      status: 'active',
      shippingFeeCents: 1500,
    },
  });
};

const seedVariant = (productId: string) =>
  prisma.variant.create({
    data: {
      productId,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 10,
      quantitySold: 1,
      attributes: { size: 'M' },
      active: true,
    },
  });

type OrderOpts = {
  status?: 'pending' | 'paid' | 'failed' | 'refunded' | 'expired' | 'cancelled';
  fulfillmentMethod?: 'ship' | 'pickup';
  fulfillmentStatus?:
    | 'unfulfilled'
    | 'packed'
    | 'shipped'
    | 'delivered'
    | 'pickup_ready'
    | 'picked_up'
    | 'cancelled';
  withShippingAddress?: boolean;
};

const seedPaidProductOrder = async (userId: string, opts: OrderOpts = {}) => {
  const product = await seedProduct(`p-${Math.random().toString(36).slice(2, 8)}`);
  const variant = await seedVariant(product.id);
  let shippingAddressId: string | null = null;
  if (opts.withShippingAddress ?? true) {
    const addr = await prisma.shippingAddress.create({
      data: {
        userId,
        recipientName: 'Cliente Teste',
        line1: 'Rua das Flores',
        number: '123',
        district: 'Centro',
        city: 'Curitiba',
        stateCode: 'PR',
        postalCode: '80000-000',
        isDefault: false,
      },
    });
    shippingAddressId = addr.id;
  }
  const status = opts.status ?? 'paid';
  return prisma.order.create({
    data: {
      userId,
      kind: 'product',
      amountCents: 6500,
      quantity: 1,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      providerRef: `pi_${Math.random().toString(36).slice(2, 10)}`,
      shippingAddressId,
      shippingCents: 1500,
      fulfillmentMethod: opts.fulfillmentMethod ?? 'ship',
      fulfillmentStatus: opts.fulfillmentStatus ?? 'unfulfilled',
      status,
      paidAt: status === 'paid' ? new Date() : null,
      items: {
        create: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      },
    },
  });
};

const orgAuth = async () => {
  const { user } = await createUser({
    email: `org-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    verified: true,
    role: 'organizer',
  });
  return { user, header: bearer(loadEnv(), user.id, 'organizer') };
};

describe('Admin store orders queue', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /admin/store/orders', () => {
    it('returns only product and mixed orders with totals', async () => {
      const buyer = await createUser({ email: 'buyer@jdm.test', verified: true });
      await seedPaidProductOrder(buyer.user.id, { fulfillmentStatus: 'unfulfilled' });
      await seedPaidProductOrder(buyer.user.id, {
        fulfillmentStatus: 'shipped',
        fulfillmentMethod: 'ship',
      });
      await seedPaidProductOrder(buyer.user.id, {
        fulfillmentStatus: 'delivered',
        fulfillmentMethod: 'ship',
      });

      // Ticket-only order — must be excluded.
      const event = await prisma.event.create({
        data: {
          slug: 'evt-x',
          title: 'Evento X',
          description: 'd',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          city: 'SP',
          stateCode: 'SP',
          type: 'meeting',
          status: 'published',
          capacity: 10,
          maxTicketsPerUser: 5,
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 10,
          sortOrder: 0,
        },
      });
      await prisma.order.create({
        data: {
          userId: buyer.user.id,
          eventId: event.id,
          tierId: tier.id,
          kind: 'ticket',
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date(),
        },
      });

      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/orders',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreOrderListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(3);
      expect(body.items.every((i) => i.kind === 'product' || i.kind === 'mixed')).toBe(true);
      expect(body.totals.all).toBe(3);
      expect(body.totals.unfulfilled).toBe(1);
      expect(body.totals.shipped).toBe(1);
      expect(body.totals.delivered).toBe(1);
      expect(body.totals.open).toBe(2); // unfulfilled + shipped (not terminal)
    });

    it('filters by status=open', async () => {
      const buyer = await createUser({ email: 'buyer2@jdm.test', verified: true });
      await seedPaidProductOrder(buyer.user.id, { fulfillmentStatus: 'unfulfilled' });
      await seedPaidProductOrder(buyer.user.id, { fulfillmentStatus: 'delivered' });
      await seedPaidProductOrder(buyer.user.id, { fulfillmentStatus: 'cancelled' });

      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/orders?status=open',
        headers: { authorization: header },
      });
      const body = adminStoreOrderListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.fulfillmentStatus).toBe('unfulfilled');
    });

    it('filters by q on customer email', async () => {
      const target = await createUser({ email: 'pedido-target@jdm.test', verified: true });
      const other = await createUser({ email: 'noise@jdm.test', verified: true });
      await seedPaidProductOrder(target.user.id);
      await seedPaidProductOrder(other.user.id);

      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/orders?q=pedido-target',
        headers: { authorization: header },
      });
      const body = adminStoreOrderListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.customerEmail).toBe('pedido-target@jdm.test');
    });

    it('preserves trackingCode in list after shipped → delivered transition', async () => {
      const buyer = await createUser({ email: 'track-list@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'packed',
      });
      const { header } = await orgAuth();

      const ship = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'shipped', trackingCode: 'BR987654321' },
      });
      expect(ship.statusCode).toBe(200);

      const deliver = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'delivered' },
      });
      expect(deliver.statusCode).toBe(200);

      const list = await app.inject({
        method: 'GET',
        url: '/admin/store/orders',
        headers: { authorization: header },
      });
      expect(list.statusCode).toBe(200);
      const body = adminStoreOrderListResponseSchema.parse(list.json());
      const row = body.items.find((i) => i.id === order.id);
      expect(row).toBeDefined();
      expect(row!.fulfillmentStatus).toBe('delivered');
      expect(row!.trackingCode).toBe('BR987654321');
    });

    it('rejects staff role', async () => {
      const { user } = await createUser({ email: 'staff@jdm.test', verified: true, role: 'staff' });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/orders',
        headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/store/orders' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /admin/store/orders/:id', () => {
    it('returns order detail with items and shipping address', async () => {
      const buyer = await createUser({ email: 'detail@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id);
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: `/admin/store/orders/${order.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreOrderDetailSchema.parse(res.json());
      expect(body.id).toBe(order.id);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.kind).toBe('product');
      expect(body.shippingAddress?.city).toBe('Curitiba');
      expect(body.customer.email).toBe('detail@jdm.test');
    });

    // Task 9: the refund screen needs to know, before the operator presses
    // the button, how many OTHER orders and tickets a full Stripe refund of
    // THIS order would take down via the charge.refunded cartId cascade
    // (stripe-webhook.ts). refundImpact carries that count.
    describe('refundImpact (cart-fanout blast radius)', () => {
      it('is zero for a solo order with no cartId', async () => {
        const buyer = await createUser({ email: 'solo@jdm.test', verified: true });
        const order = await seedPaidProductOrder(buyer.user.id);
        const { header } = await orgAuth();
        const res = await app.inject({
          method: 'GET',
          url: `/admin/store/orders/${order.id}`,
          headers: { authorization: header },
        });
        const body = adminStoreOrderDetailSchema.parse(res.json());
        expect(body.refundImpact).toEqual({
          siblingOrderCount: 0,
          siblingTicketCount: 0,
          ownTicketCount: 0,
          ownExtraItemCount: 0,
          siblingExtraItemCount: 0,
          ownVoucherCount: 0,
          siblingVoucherCount: 0,
        });
      });

      it('counts sibling orders and their valid tickets sharing the same cartId', async () => {
        const buyer = await createUser({ email: 'cart-sib@jdm.test', verified: true });
        const cart = await prisma.cart.create({
          data: { userId: buyer.user.id, status: 'converted' },
        });

        const order = await seedPaidProductOrder(buyer.user.id);
        await prisma.order.update({ where: { id: order.id }, data: { cartId: cart.id } });

        const event = await prisma.event.create({
          data: {
            slug: `evt-sib-${Math.random().toString(36).slice(2, 6)}`,
            title: 'Evento Sibling',
            description: 'd',
            startsAt: new Date(Date.now() + 86_400_000),
            endsAt: new Date(Date.now() + 90_000_000),
            city: 'SP',
            stateCode: 'SP',
            type: 'meeting',
            status: 'published',
            capacity: 10,
            maxTicketsPerUser: 5,
          },
        });
        const tier = await prisma.ticketTier.create({
          data: {
            eventId: event.id,
            name: 'Geral',
            priceCents: 5000,
            quantityTotal: 10,
            sortOrder: 0,
          },
        });
        const siblingOrder = await prisma.order.create({
          data: {
            userId: buyer.user.id,
            eventId: event.id,
            tierId: tier.id,
            cartId: cart.id,
            kind: 'ticket',
            amountCents: 5000,
            quantity: 1,
            currency: 'BRL',
            method: 'card',
            provider: 'stripe',
            status: 'paid',
            paidAt: new Date(),
          },
        });
        await prisma.ticket.create({
          data: {
            orderId: siblingOrder.id,
            userId: buyer.user.id,
            eventId: event.id,
            tierId: tier.id,
            status: 'valid',
          },
        });
        // A revoked ticket on another sibling must NOT be counted.
        const revokedSiblingOrder = await prisma.order.create({
          data: {
            userId: buyer.user.id,
            eventId: event.id,
            tierId: tier.id,
            cartId: cart.id,
            kind: 'ticket',
            amountCents: 5000,
            quantity: 1,
            currency: 'BRL',
            method: 'card',
            provider: 'stripe',
            status: 'refunded',
            paidAt: new Date(),
          },
        });
        await prisma.ticket.create({
          data: {
            orderId: revokedSiblingOrder.id,
            userId: buyer.user.id,
            eventId: event.id,
            tierId: tier.id,
            status: 'revoked',
          },
        });

        const { header } = await orgAuth();
        const res = await app.inject({
          method: 'GET',
          url: `/admin/store/orders/${order.id}`,
          headers: { authorization: header },
        });
        const body = adminStoreOrderDetailSchema.parse(res.json());
        // ownTicketCount is 0 here: a product order carries no tickets of its
        // own. It is the whole blast radius for a ticket order — see
        // test/admin/order-detail.test.ts.
        expect(body.refundImpact).toEqual({
          siblingOrderCount: 2,
          siblingTicketCount: 1,
          ownTicketCount: 0,
          ownExtraItemCount: 0,
          siblingExtraItemCount: 0,
          ownVoucherCount: 0,
          siblingVoucherCount: 0,
        });
      });
    });

    it('returns 404 for ticket-only orders', async () => {
      const buyer = await createUser({ email: 'tk@jdm.test', verified: true });
      const event = await prisma.event.create({
        data: {
          slug: 'evt-tk',
          title: 'TK',
          description: 'd',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          city: 'SP',
          stateCode: 'SP',
          type: 'meeting',
          status: 'published',
          capacity: 10,
          maxTicketsPerUser: 5,
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 10,
          sortOrder: 0,
        },
      });
      const ticketOrder = await prisma.order.create({
        data: {
          userId: buyer.user.id,
          eventId: event.id,
          tierId: tier.id,
          kind: 'ticket',
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date(),
        },
      });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: `/admin/store/orders/${ticketOrder.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /admin/store/orders/:id/fulfillment', () => {
    it('transitions ship: unfulfilled → packed and writes audit', async () => {
      const buyer = await createUser({ email: 'patch@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'unfulfilled',
      });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed', note: 'embalado e pronto' },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreOrderDetailSchema.parse(res.json());
      expect(body.fulfillmentStatus).toBe('packed');
      expect(body.history).toHaveLength(1);
      expect(body.history[0]!.action).toBe('store.order.fulfillment_update');

      const audit = await prisma.adminAudit.findFirst({
        where: { entityType: 'order', entityId: order.id },
      });
      expect(audit).not.toBeNull();
      const meta = audit!.metadata as Record<string, unknown>;
      expect(meta.from).toBe('unfulfilled');
      expect(meta.to).toBe('packed');
      expect(meta.note).toBe('embalado e pronto');
    });

    it('persists trackingCode when transitioning to shipped', async () => {
      const buyer = await createUser({ email: 'ship@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'packed',
      });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'shipped', trackingCode: 'BR123456789' },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreOrderDetailSchema.parse(res.json());
      expect(body.fulfillmentStatus).toBe('shipped');
      expect(body.trackingCode).toBe('BR123456789');
    });

    it('rejects invalid transitions', async () => {
      const buyer = await createUser({ email: 'invalid@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'unfulfilled',
      });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'delivered' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects ship transitions on pickup-method orders', async () => {
      const buyer = await createUser({ email: 'pickup@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'pickup',
        fulfillmentStatus: 'unfulfilled',
        withShippingAddress: false,
      });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('allows pickup transition: unfulfilled → pickup_ready → picked_up', async () => {
      const buyer = await createUser({ email: 'pkup@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'pickup',
        fulfillmentStatus: 'unfulfilled',
        withShippingAddress: false,
      });
      const { header } = await orgAuth();
      const r1 = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'pickup_ready' },
      });
      expect(r1.statusCode).toBe(200);
      const r2 = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'picked_up' },
      });
      expect(r2.statusCode).toBe(200);
      const body = adminStoreOrderDetailSchema.parse(r2.json());
      expect(body.fulfillmentStatus).toBe('picked_up');
      expect(body.history).toHaveLength(2);
    });

    it('rejects fulfillment update on unpaid orders', async () => {
      const buyer = await createUser({ email: 'unpaid@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, { status: 'pending' });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects requests with shipped status but no trackingCode', async () => {
      const buyer = await createUser({ email: 'notrack@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, {
        fulfillmentMethod: 'ship',
        fulfillmentStatus: 'packed',
      });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'shipped' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects staff role', async () => {
      const buyer = await createUser({ email: 'staff-pat@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id);
      const { user: staffUser } = await createUser({
        email: 'staff2@jdm.test',
        verified: true,
        role: 'staff',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: {
          authorization: bearer(loadEnv(), staffUser.id, 'staff'),
          'content-type': 'application/json',
        },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('paid-only fulfillment queue invariant', () => {
    it.each(['pending', 'failed', 'expired', 'cancelled'] as const)(
      'excludes orders with payment status %s from listing',
      async (paymentStatus) => {
        const buyer = await createUser({
          email: `buyer-${paymentStatus}@jdm.test`,
          verified: true,
        });
        await seedPaidProductOrder(buyer.user.id, { status: paymentStatus });
        await seedPaidProductOrder(buyer.user.id, { status: 'paid' });

        const { header } = await orgAuth();
        const res = await app.inject({
          method: 'GET',
          url: '/admin/store/orders',
          headers: { authorization: header },
        });
        expect(res.statusCode).toBe(200);
        const body = adminStoreOrderListResponseSchema.parse(res.json());
        expect(body.items).toHaveLength(1);
        expect(body.items[0]!.paymentStatus).toBe('paid');
        expect(body.totals.all).toBe(1);
      },
    );

    it('excludes refunded orders from fulfillment queue', async () => {
      const buyer = await createUser({ email: 'buyer-refund@jdm.test', verified: true });
      await seedPaidProductOrder(buyer.user.id, { status: 'refunded' });

      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/orders',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreOrderListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(0);
      expect(body.totals.all).toBe(0);
    });

    it('rejects fulfillment update on pending order (409)', async () => {
      const buyer = await createUser({ email: 'pending-ful@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, { status: 'pending' });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Conflict' });
    });

    it('rejects fulfillment update on failed order (409)', async () => {
      const buyer = await createUser({ email: 'failed-ful@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, { status: 'failed' });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Conflict' });
    });

    it('rejects fulfillment update on expired order (409)', async () => {
      const buyer = await createUser({ email: 'expired-ful@jdm.test', verified: true });
      const order = await seedPaidProductOrder(buyer.user.id, { status: 'expired' });
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Conflict' });
    });
  });

  // PR #364 review: virtual orders settle automatically via fulfillGarageSpotsForOrder
  // and never enter the admin store workflow. Detail/update must reject them.
  describe('virtual-order exclusion (PR #364 review)', () => {
    const seedPaidVirtualOrder = async (userId: string) => {
      const pt = await prisma.productType.create({
        data: { name: `t-${Math.random().toString(36).slice(2, 6)}` },
      });
      const product = await prisma.product.create({
        data: {
          slug: `g-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Vaga Virtual',
          description: '-',
          productTypeId: pt.id,
          basePriceCents: 5000,
          currency: 'BRL',
          status: 'active',
          virtual: true,
          allowPickup: false,
          allowShip: false,
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'Padrão',
          priceCents: 5000,
          quantityTotal: 0,
          quantitySold: 0,
          attributes: {},
          active: true,
        },
      });
      return prisma.order.create({
        data: {
          userId,
          kind: 'product',
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date(),
          fulfillmentMethod: 'virtual',
          fulfillmentStatus: 'virtual_complete',
          items: {
            create: {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 5000,
              subtotalCents: 5000,
            },
          },
        },
      });
    };

    it('GET /admin/store/orders/:id returns 404 for a virtual order', async () => {
      const buyer = await createUser({ email: 'virt-detail@jdm.test', verified: true });
      const order = await seedPaidVirtualOrder(buyer.user.id);
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: `/admin/store/orders/${order.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /admin/store/orders/:id/fulfillment returns 409 for a virtual order', async () => {
      const buyer = await createUser({ email: 'virt-patch@jdm.test', verified: true });
      const order = await seedPaidVirtualOrder(buyer.user.id);
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
    });

    // PR #364 review (round 2): a `mixed` order containing only a ticket line
    // plus a virtual product line can carry fulfillmentMethod='pickup' from
    // the ticket but has no physical product OrderItem. It must not appear in
    // the queue, nor be reachable via detail/update.
    const seedMixedTicketPlusVirtualOrder = async (userId: string) => {
      const pt = await prisma.productType.create({
        data: { name: `t-${Math.random().toString(36).slice(2, 6)}` },
      });
      const virtualProduct = await prisma.product.create({
        data: {
          slug: `gv-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Vaga Virtual Mixed',
          description: '-',
          productTypeId: pt.id,
          basePriceCents: 5000,
          currency: 'BRL',
          status: 'active',
          virtual: true,
          allowPickup: false,
          allowShip: false,
        },
      });
      const virtualVariant = await prisma.variant.create({
        data: {
          productId: virtualProduct.id,
          name: 'Padrão',
          priceCents: 5000,
          quantityTotal: 0,
          quantitySold: 0,
          attributes: {},
          active: true,
        },
      });
      const event = await prisma.event.create({
        data: {
          slug: `evt-mxt-${Math.random().toString(36).slice(2, 6)}`,
          title: 'Mixed Ticket+Virtual',
          description: 'd',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          city: 'SP',
          stateCode: 'SP',
          type: 'meeting',
          status: 'published',
          capacity: 10,
          maxTicketsPerUser: 5,
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 10,
          sortOrder: 0,
        },
      });
      return prisma.order.create({
        data: {
          userId,
          kind: 'mixed',
          amountCents: 10000,
          quantity: 2,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date(),
          // ticket lines force pickup at the order level; no physical product item.
          fulfillmentMethod: 'pickup',
          fulfillmentStatus: 'unfulfilled',
          items: {
            create: [
              {
                kind: 'ticket',
                eventId: event.id,
                tierId: tier.id,
                quantity: 1,
                unitPriceCents: 5000,
                subtotalCents: 5000,
              },
              {
                kind: 'product',
                variantId: virtualVariant.id,
                quantity: 1,
                unitPriceCents: 5000,
                subtotalCents: 5000,
              },
            ],
          },
        },
      });
    };

    it('GET /admin/store/orders excludes mixed ticket+virtual orders', async () => {
      const buyer = await createUser({ email: 'mxt-list@jdm.test', verified: true });
      await seedMixedTicketPlusVirtualOrder(buyer.user.id);
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/store/orders',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(200);
      const body = adminStoreOrderListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(0);
      expect(body.totals.all).toBe(0);
    });

    it('GET /admin/store/orders/:id returns 404 for a mixed ticket+virtual order', async () => {
      const buyer = await createUser({ email: 'mxt-detail@jdm.test', verified: true });
      const order = await seedMixedTicketPlusVirtualOrder(buyer.user.id);
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'GET',
        url: `/admin/store/orders/${order.id}`,
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /admin/store/orders/:id/fulfillment returns 409 for a mixed ticket+virtual order', async () => {
      const buyer = await createUser({ email: 'mxt-patch@jdm.test', verified: true });
      const order = await seedMixedTicketPlusVirtualOrder(buyer.user.id);
      const { header } = await orgAuth();
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: header, 'content-type': 'application/json' },
        payload: { status: 'pickup_ready' },
      });
      expect(res.statusCode).toBe(409);
    });
  });
});
