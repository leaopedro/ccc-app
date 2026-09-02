/**
 * GET /admin/orders/:id — the kind-agnostic read behind the refund screen.
 *
 * The gap this closes: POST /admin/orders/:id/refund always accepted every
 * order kind, but the only screen that could reach it read
 * /admin/store/orders/:id, which 404s anything that is not a physical store
 * order. `Order.kind` DEFAULTS to `ticket`, so the club's most common order
 * had no page and no button.
 *
 * Three things these tests hold down:
 *   1. a ticket order is viewable and refundable;
 *   2. its blast radius matches what `charge.refunded` ACTUALLY revokes,
 *      asserted by running the webhook, not by restating the query;
 *   3. the store fulfillment workflow stays unreachable for it.
 */
import { prisma } from '@ccc/db';
import { adminOrderDetailSchema } from '@ccc/shared/admin';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();
const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const refundEvent = (
  eventId: string,
  paymentIntent: string,
  amount: number,
  amountRefunded: number,
) => ({
  id: eventId,
  type: 'charge.refunded',
  data: {
    object: {
      id: `ch_${eventId}`,
      payment_intent: paymentIntent,
      amount,
      amount_refunded: amountRefunded,
      refunded: amountRefunded >= amount,
    },
  },
});

describe('GET /admin/orders/:id', () => {
  let ctx: Awaited<ReturnType<typeof makeAppWithFakeStripe>>;
  let adminAuth: string;
  let organizerAuth: string;
  let buyerId: string;
  let eventId: string;
  let tierId: string;

  beforeAll(async () => {
    ctx = await makeAppWithFakeStripe();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    ctx.stripe.calls.length = 0;

    const { user: admin } = await createUser({
      email: 'orderdetail-admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    adminAuth = bearer(env, admin.id, 'admin');

    const { user: organizer } = await createUser({
      email: 'orderdetail-org@jdm.test',
      role: 'organizer',
      verified: true,
    });
    organizerAuth = bearer(env, organizer.id, 'organizer');

    const { user: buyer } = await createUser({
      email: 'orderdetail-buyer@jdm.test',
      verified: true,
    });
    buyerId = buyer.id;

    const event = await prisma.event.create({
      data: {
        slug: `evt-od-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Track Day Interlagos',
        description: 'd',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 20,
        maxTicketsPerUser: 5,
      },
    });
    eventId = event.id;
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Pista',
        priceCents: 15_000,
        quantityTotal: 20,
        sortOrder: 0,
      },
    });
    tierId = tier.id;
  });

  /**
   * The shape `POST /orders` writes (routes/orders.ts, createPendingOrder):
   * eventId / tierId / quantity plus OrderExtra rows and NO OrderItem rows.
   * This is the commonest order in the database, and the one the store detail
   * could never show.
   */
  const seedTicketOrder = async (opts: {
    quantity?: number;
    tickets?: number;
    providerRef?: string | null;
    cartId?: string | null;
    status?: 'paid' | 'pending';
  }) => {
    const quantity = opts.quantity ?? 1;
    const order = await prisma.order.create({
      data: {
        userId: buyerId,
        eventId,
        tierId,
        kind: 'ticket',
        amountCents: 15_000 * quantity,
        quantity,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: opts.providerRef === undefined ? 'pi_ticket_anchor' : opts.providerRef,
        cartId: opts.cartId ?? null,
        status: opts.status ?? 'paid',
        paidAt: (opts.status ?? 'paid') === 'paid' ? new Date() : null,
      },
    });
    for (let i = 0; i < (opts.tickets ?? quantity); i += 1) {
      await prisma.ticket.create({
        data: { orderId: order.id, userId: buyerId, eventId, tierId, status: 'valid' },
      });
    }
    return order;
  };

  const getDetail = async (id: string, auth = adminAuth) =>
    ctx.app.inject({ method: 'GET', url: `/admin/orders/${id}`, headers: { authorization: auth } });

  it('serves a ticket order that /admin/store/orders/:id refuses', async () => {
    const order = await seedTicketOrder({ quantity: 2, tickets: 2 });

    const storeRes = await ctx.app.inject({
      method: 'GET',
      url: `/admin/store/orders/${order.id}`,
      headers: { authorization: organizerAuth },
    });
    expect(storeRes.statusCode).toBe(404);

    const res = await getDetail(order.id);
    expect(res.statusCode).toBe(200);
    const body = adminOrderDetailSchema.parse(res.json());
    expect(body.kind).toBe('ticket');
    expect(body.paymentStatus).toBe('paid');
    expect(body.eventTitle).toBe('Track Day Interlagos');
    expect(body.customer.email).toBe('orderdetail-buyer@jdm.test');
  });

  // A ticket order has no OrderItem rows, so an OrderItem-shaped list renders
  // it as an empty table — the exact "meaningless section" this screen must
  // not have.
  it('builds lines from eventId/tierId/quantity when the order has no OrderItem rows', async () => {
    const order = await seedTicketOrder({ quantity: 3, tickets: 3 });
    const extra = await prisma.ticketExtra.create({
      data: { eventId, name: 'Camiseta oficial', priceCents: 6000, quantityTotal: 10 },
    });
    await prisma.orderExtra.create({
      data: { orderId: order.id, extraId: extra.id, quantity: 2 },
    });

    const body = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({
      kind: 'ticket',
      label: 'Ingresso · Pista',
      sublabel: 'Track Day Interlagos',
      quantity: 3,
      // Null, not 0: Order.amountCents already mixes the dev fee and shipping,
      // so any per-line split would be a guess rendered as a currency.
      unitPriceCents: null,
      subtotalCents: null,
    });
    expect(body.lines[1]).toMatchObject({
      kind: 'extras',
      label: 'Extra · Camiseta oficial',
      quantity: 2,
    });
  });

  it('carries no fulfillment fields at all', async () => {
    const order = await seedTicketOrder({});
    const body = (await getDetail(order.id)).json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('fulfillmentStatus');
    expect(body).not.toHaveProperty('fulfillmentMethod');
    expect(body).not.toHaveProperty('shippingAddress');
    expect(body.fulfillmentSurface).toBe('none');
  });

  it('404s an unknown order', async () => {
    const res = await getDetail('ord_does_not_exist');
    expect(res.statusCode).toBe(404);
  });

  it('rejects an organizer caller (matches the admin-only refund route)', async () => {
    const order = await seedTicketOrder({});
    const res = await getDetail(order.id, organizerAuth);
    expect(res.statusCode).toBe(403);
  });

  describe('refundImpact for a ticket order', () => {
    it('counts this order own valid tickets, which the store shape never did', async () => {
      const order = await seedTicketOrder({ quantity: 2, tickets: 2 });
      const body = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
      expect(body.refundImpact).toEqual({
        siblingOrderCount: 0,
        siblingTicketCount: 0,
        ownTicketCount: 2,
        ownExtraItemCount: 0,
        siblingExtraItemCount: 0,
        ownVoucherCount: 0,
        siblingVoucherCount: 0,
      });
    });

    it('ignores tickets that are already revoked', async () => {
      const order = await seedTicketOrder({ quantity: 2, tickets: 2 });
      const first = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
      await prisma.ticket.update({ where: { id: first.id }, data: { status: 'revoked' } });
      const body = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
      expect(body.refundImpact.ownTicketCount).toBe(1);
    });

    /**
     * The count is only worth showing if it matches reality. This drives the
     * real `charge.refunded` handler and compares the tickets it revoked
     * against what the screen promised, so a change to the cascade breaks
     * this test rather than silently lying to the operator.
     */
    it('predicts exactly the tickets charge.refunded goes on to revoke', async () => {
      const cart = await prisma.cart.create({ data: { userId: buyerId, status: 'converted' } });
      const anchor = await seedTicketOrder({
        quantity: 2,
        tickets: 2,
        cartId: cart.id,
        providerRef: 'pi_cart_anchor',
      });
      // Only the canonical order carries providerRef; the siblings ride the
      // same PaymentIntent and are reached through cartId.
      await seedTicketOrder({ quantity: 1, tickets: 1, cartId: cart.id, providerRef: null });
      await seedTicketOrder({ quantity: 3, tickets: 3, cartId: cart.id, providerRef: null });

      const body = adminOrderDetailSchema.parse((await getDetail(anchor.id)).json());
      expect(body.refundImpact).toEqual({
        siblingOrderCount: 2,
        siblingTicketCount: 4,
        ownTicketCount: 2,
        ownExtraItemCount: 0,
        siblingExtraItemCount: 0,
        ownVoucherCount: 0,
        siblingVoucherCount: 0,
      });
      const predicted =
        body.refundImpact.siblingTicketCount + (body.refundImpact.ownTicketCount ?? 0);

      ctx.stripe.nextEvent = refundEvent('evt_od_cascade', 'pi_cart_anchor', 30_000, 30_000);
      const hook = await ctx.app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(ctx.stripe.nextEvent),
      });
      expect(hook.statusCode).toBe(200);

      const revoked = await prisma.ticket.count({ where: { status: 'revoked' } });
      expect(revoked).toBe(predicted);
      expect(revoked).toBe(6);
    });
  });

  /**
   * `TicketExtra` is per-EVENT and shared by every attendee; `TicketExtraItem`
   * is per-TICKET. Refunding one buyer's extras order must therefore never be
   * scoped by `extraId` alone — that predicate matches every attendee who
   * bought the same extra at the same event.
   */
  describe('refunding an extras order stays inside the buyer', () => {
    const seedExtrasOnlyOrder = async (opts: {
      userId: string;
      extraId: string;
      providerRef: string;
      quantity?: number;
    }) =>
      prisma.order.create({
        data: {
          userId: opts.userId,
          eventId,
          tierId,
          kind: 'extras_only',
          amountCents: 6000 * (opts.quantity ?? 1),
          quantity: opts.quantity ?? 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: opts.providerRef,
          status: 'paid',
          paidAt: new Date(),
          orderExtras: { create: { extraId: opts.extraId, quantity: opts.quantity ?? 1 } },
        },
      });

    const seedAttendeeWithExtra = async (email: string, extraId: string) => {
      const { user } = await createUser({ email, verified: true });
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          eventId,
          tierId,
          kind: 'ticket',
          amountCents: 15_000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_ticket_${email.split('@')[0]}`,
          status: 'paid',
          paidAt: new Date(),
        },
      });
      const ticket = await prisma.ticket.create({
        data: { orderId: order.id, userId: user.id, eventId, tierId, status: 'valid' },
      });
      const item = await prisma.ticketExtraItem.create({
        data: {
          ticketId: ticket.id,
          extraId,
          code: `code-${ticket.id}-${extraId}`,
          status: 'valid',
        },
      });
      return { user, ticket, item };
    };

    const refund = async (eventKey: string, providerRef: string, amount: number) => {
      ctx.stripe.nextEvent = refundEvent(eventKey, providerRef, amount, amount);
      const hook = await ctx.app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(ctx.stripe.nextEvent),
      });
      expect(hook.statusCode).toBe(200);
    };

    it('revokes only the refunded buyer extra item, not every buyer of that extra', async () => {
      const extra = await prisma.ticketExtra.create({
        data: { eventId, name: 'Camiseta oficial', priceCents: 6000, quantityTotal: 50 },
      });
      const alice = await seedAttendeeWithExtra('extras-alice@jdm.test', extra.id);
      const bob = await seedAttendeeWithExtra('extras-bob@jdm.test', extra.id);
      const carol = await seedAttendeeWithExtra('extras-carol@jdm.test', extra.id);

      const aliceExtrasOrder = await seedExtrasOnlyOrder({
        userId: alice.user.id,
        extraId: extra.id,
        providerRef: 'pi_extras_alice',
      });

      await refund('evt_od_extras_alice', 'pi_extras_alice', 6000);

      const statuses = await prisma.ticketExtraItem.findMany({
        where: { extraId: extra.id },
        select: { id: true, status: true },
      });
      const byId = new Map(statuses.map((s) => [s.id, s.status]));
      expect(byId.get(alice.item.id)).toBe('revoked');
      expect(byId.get(bob.item.id)).toBe('valid');
      expect(byId.get(carol.item.id)).toBe('valid');
      expect(statuses.filter((s) => s.status === 'revoked')).toHaveLength(1);

      // The order that was refunded is the only one whose row moved.
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: aliceExtrasOrder.id } })).status,
      ).toBe('refunded');
    });

    it('counts the extra items it will revoke in refundImpact', async () => {
      const extra = await prisma.ticketExtra.create({
        data: { eventId, name: 'Camiseta oficial', priceCents: 6000, quantityTotal: 50 },
      });
      const alice = await seedAttendeeWithExtra('impact-alice@jdm.test', extra.id);
      await seedAttendeeWithExtra('impact-bob@jdm.test', extra.id);

      const order = await seedExtrasOnlyOrder({
        userId: alice.user.id,
        extraId: extra.id,
        providerRef: 'pi_extras_impact',
      });

      const body = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
      // An extras_only order owns no Ticket rows, so a ticket-only impact reads
      // 0 and the operator sees no warning at all before destroying goods.
      expect(body.refundImpact.ownTicketCount).toBe(0);
      expect(body.refundImpact.ownExtraItemCount).toBe(1);

      await refund('evt_od_extras_impact', 'pi_extras_impact', 6000);

      const revoked = await prisma.ticketExtraItem.count({ where: { status: 'revoked' } });
      expect(revoked).toBe(body.refundImpact.ownExtraItemCount);
    });
  });

  describe('the store fulfillment workflow stays unreachable', () => {
    it('refuses a fulfillment transition on a ticket order and leaves the row alone', async () => {
      const order = await seedTicketOrder({});
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/admin/store/orders/${order.id}/fulfillment`,
        headers: { authorization: organizerAuth },
        payload: { status: 'packed' },
      });
      expect(res.statusCode).toBe(409);
      const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(reloaded.fulfillmentStatus).toBe('unfulfilled');
    });

    // Order.fulfillmentMethod DEFAULTS to `pickup`, so a ticket order looks
    // pickup-shaped in the database. That must not be read as a workflow.
    it('does not turn the default pickup method into a store surface', async () => {
      const order = await seedTicketOrder({});
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).fulfillmentMethod,
      ).toBe('pickup');
      const body = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
      expect(body.fulfillmentSurface).toBe('none');
    });

    // fulfillmentSurface: 'store' must never point at a 404, so it has to
    // agree with what /admin/store/orders/:id actually serves.
    it('reports "store" only for an order the store detail really serves', async () => {
      const productType = await prisma.productType.upsert({
        where: { name: 'Vestuário' },
        update: {},
        create: { name: 'Vestuário' },
      });
      const product = await prisma.product.create({
        data: {
          slug: `p-od-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Moletom',
          description: 'd',
          basePriceCents: 5000,
          productTypeId: productType.id,
          status: 'active',
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'M',
          priceCents: 5000,
          quantityTotal: 5,
          attributes: { size: 'M' },
          active: true,
        },
      });
      const order = await prisma.order.create({
        data: {
          userId: buyerId,
          kind: 'product',
          amountCents: 5000,
          quantity: 1,
          currency: 'BRL',
          method: 'card',
          provider: 'stripe',
          providerRef: 'pi_product_od',
          fulfillmentMethod: 'ship',
          status: 'paid',
          paidAt: new Date(),
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

      const body = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
      expect(body.fulfillmentSurface).toBe('store');
      expect(body.lines[0]).toMatchObject({ kind: 'product', label: 'Moletom' });

      const storeRes = await ctx.app.inject({
        method: 'GET',
        url: `/admin/store/orders/${order.id}`,
        headers: { authorization: organizerAuth },
      });
      expect(storeRes.statusCode).toBe(200);
    });
  });

  it('lets the admin actually refund the ticket order it just showed', async () => {
    const order = await seedTicketOrder({ quantity: 1, tickets: 1 });

    const detail = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
    expect(detail.providerRef).toBe('pi_ticket_anchor');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${order.id}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'evento cancelado pela organizacao' },
    });
    expect(res.statusCode).toBe(202);
    expect(
      ctx.stripe.calls.some(
        (c) =>
          c.kind === 'refund' &&
          (c.payload as { paymentIntentId?: string }).paymentIntentId === 'pi_ticket_anchor',
      ),
    ).toBe(true);

    // Still `paid`: the 202 is a REQUEST. Only charge.refunded flips it.
    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    // The audit row lands, so the refreshed screen shows it in Histórico.
    const after = adminOrderDetailSchema.parse((await getDetail(order.id)).json());
    expect(after.history.some((h) => h.action === 'order.refund_requested')).toBe(true);
  });
});
