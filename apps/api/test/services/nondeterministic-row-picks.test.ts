/**
 * Reads whose RESULT IDENTITY has a consequence, over predicates that match
 * more than one row.
 *
 * Every case here shares one shape: a query orders on a column that can tie,
 * takes one row (or index 0), and that row decides something real. Postgres
 * owes nothing on a tie — it hands back whatever the plan happens to produce,
 * which is usually heap order, and heap order is not a contract. The fix in
 * each case is to end the sort in `id`, the primary key.
 *
 * `createdAt` DEFAULTs to `CURRENT_TIMESTAMP`, which in Postgres is
 * TRANSACTION start time, so rows written by one transaction share a
 * byte-identical timestamp. That is why `createdAt` on its own is never a total
 * order over rows the app writes together.
 *
 * How these tests bite. Each seeds two rows that tie on the ordering column and
 * pins explicit ids so that id order is the OPPOSITE of insert order, then
 * asserts the id-ordered winner. The unfixed code returns rows in heap order,
 * i.e. insert order, so it returns the other row and the assertion fails. Each
 * case is also run with the inserts swapped: the rule is "lowest id wins", not
 * "the second row wins", and only asserting both pins the rule rather than the
 * plan.
 */
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { pickPremiumGrantableTier } from '../../src/services/billing/tier-selection.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { issueTicketForPaidOrder } from '../../src/services/tickets/issue.js';
import { createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();
const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

/** Fixed timestamp shared by every tying row, standing in for "one transaction". */
const TIED_AT = new Date('2026-03-01T12:00:00.000Z');

/** Ids chosen so `a_...` < `z_...` lexicographically, which is how Postgres sorts text. */
const LOW_ID = 'a0000000000000000000000low';
const HIGH_ID = 'z0000000000000000000000high';

const seedEvent = async (opts?: { maxTicketsPerUser?: number }) =>
  prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 100,
      maxTicketsPerUser: opts?.maxTicketsPerUser ?? 5,
      publishedAt: new Date(),
    },
  });

const seedTier = async (
  eventId: string,
  o: { id?: string; name: string; sortOrder: number; isPremiumGrantable?: boolean },
) =>
  prisma.ticketTier.create({
    data: {
      ...(o.id ? { id: o.id } : {}),
      eventId,
      name: o.name,
      priceCents: 5000,
      quantityTotal: 100,
      sortOrder: o.sortOrder,
      isPremiumGrantable: o.isPremiumGrantable ?? false,
    },
  });

describe('nondeterministic row picks', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // ---------------------------------------------------------------------------
  // 1. Premium grant tier selection (services/billing/tier-selection.ts).
  // ---------------------------------------------------------------------------
  //
  // `TicketTier.sortOrder` is `Int @default(0)` with no unique constraint, so an
  // event whose tiers an admin never reordered has every tier at 0. The tier
  // this returns decides which tier's `quantityTotal` the member's free ticket
  // consumes and which tier's perks they get, and the two callers (the F8.06
  // backfill worker and the F8.07 publish-grant worker) can reach the same event
  // and disagree.

  describe('pickPremiumGrantableTier — tiers tied on sortOrder', () => {
    it.each([
      ['low id inserted last', false],
      ['low id inserted first', true],
    ])('picks the lowest id among tiers tied at sortOrder 0 (%s)', async (_label, lowFirst) => {
      const event = await seedEvent();
      const low = { id: LOW_ID, name: 'Tier A', sortOrder: 0, isPremiumGrantable: true };
      const high = { id: HIGH_ID, name: 'Tier Z', sortOrder: 0, isPremiumGrantable: true };

      if (lowFirst) {
        await seedTier(event.id, low);
        await seedTier(event.id, high);
      } else {
        await seedTier(event.id, high);
        await seedTier(event.id, low);
      }

      const picked = await pickPremiumGrantableTier(prisma, event.id);
      expect(picked?.id).toBe(LOW_ID);
    });

    it('still honours sortOrder over id when sortOrder actually differs', async () => {
      const event = await seedEvent();
      // The tie-break must not outrank the real key: the HIGH id sorts first
      // here because its sortOrder is lower.
      await seedTier(event.id, {
        id: LOW_ID,
        name: 'Segundo',
        sortOrder: 5,
        isPremiumGrantable: true,
      });
      await seedTier(event.id, {
        id: HIGH_ID,
        name: 'Primeiro',
        sortOrder: 1,
        isPremiumGrantable: true,
      });

      const picked = await pickPremiumGrantableTier(prisma, event.id);
      expect(picked?.id).toBe(HIGH_ID);
    });

    it('ignores non-grantable tiers however they sort', async () => {
      const event = await seedEvent();
      await seedTier(event.id, {
        id: LOW_ID,
        name: 'Nao concedivel',
        sortOrder: 0,
        isPremiumGrantable: false,
      });
      await seedTier(event.id, {
        id: HIGH_ID,
        name: 'Concedivel',
        sortOrder: 0,
        isPremiumGrantable: true,
      });

      const picked = await pickPremiumGrantableTier(prisma, event.id);
      expect(picked?.id).toBe(HIGH_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Extras-only attachment (services/tickets/issue.ts).
  // ---------------------------------------------------------------------------
  //
  // The (userId, eventId) WHERE status='valid' unique index was DROPPED in
  // migration 20260503163319_drop_ticket_user_event_unique, precisely so a buyer
  // can hold several valid tickets to one event. So this read is genuinely
  // multi-row, and the ticket it returns is the one the purchased extra gets
  // bound to. If a redelivery picks the other ticket, the buyer presents the
  // ticket they were given and the extra they paid for is not on it.

  describe('issueTicketForPaidOrder — extras_only over several valid tickets', () => {
    const seedTwoTiedTickets = async (
      userId: string,
      eventId: string,
      tierId: string,
      lowFirst: boolean,
    ) => {
      const mk = (id: string) =>
        prisma.ticket.create({
          data: { id, userId, eventId, tierId, source: 'purchase', status: 'valid' },
        });
      if (lowFirst) {
        await mk(LOW_ID);
        await mk(HIGH_ID);
      } else {
        await mk(HIGH_ID);
        await mk(LOW_ID);
      }
      // Force the exact tie a single issuance transaction produces.
      await prisma.ticket.updateMany({
        where: { id: { in: [LOW_ID, HIGH_ID] } },
        data: { createdAt: TIED_AT },
      });
    };

    it.each([
      ['low id inserted last', false],
      ['low id inserted first', true],
    ])('binds the extra to the lowest-id valid ticket (%s)', async (_label, lowFirst) => {
      const { user } = await createUser({ verified: true });
      const event = await seedEvent();
      const tier = await seedTier(event.id, { name: 'Geral', sortOrder: 0 });
      await seedTwoTiedTickets(user.id, event.id, tier.id, lowFirst);

      const extra = await prisma.ticketExtra.create({
        data: {
          eventId: event.id,
          name: 'Camiseta',
          priceCents: 3000,
          currency: 'BRL',
          quantityTotal: 10,
          quantitySold: 0,
          sortOrder: 0,
        },
      });

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          kind: 'extras_only',
          amountCents: 3000,
          quantity: 1,
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_x_${Math.random().toString(36).slice(2, 10)}`,
          status: 'pending',
          orderExtras: { create: [{ extraId: extra.id, quantity: 1 }] },
        },
      });

      const result = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
      expect(result.ticketId).toBe(LOW_ID);

      const items = await prisma.ticketExtraItem.findMany({
        where: { extraId: extra.id },
        select: { ticketId: true },
      });
      expect(items).toHaveLength(1);
      expect(items[0]!.ticketId).toBe(LOW_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Ticket replay ordering (services/tickets/issue.ts, order.status='paid').
  // ---------------------------------------------------------------------------
  //
  // On a redelivery for an already-paid multi-ticket order the handler re-reads
  // the order's tickets and returns index 0 as THE ticket, signing its id into
  // the QR code it hands back. All tickets of one order are created in a single
  // transaction and share a `createdAt`, so without the `id` tie-break the QR
  // returned by the second delivery could point at a different ticket than the
  // first.

  describe('issueTicketForPaidOrder — replay on a paid multi-ticket order', () => {
    it.each([
      ['low id inserted last', false],
      ['low id inserted first', true],
    ])('returns the same ticket on every replay (%s)', async (_label, lowFirst) => {
      const { user } = await createUser({ verified: true });
      const event = await seedEvent({ maxTicketsPerUser: 5 });
      const tier = await seedTier(event.id, { name: 'Geral', sortOrder: 0 });

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          kind: 'ticket',
          amountCents: 10000,
          quantity: 2,
          method: 'card',
          provider: 'stripe',
          providerRef: `pi_r_${Math.random().toString(36).slice(2, 10)}`,
          status: 'paid',
          paidAt: new Date(),
        },
      });

      const mk = (id: string) =>
        prisma.ticket.create({
          data: {
            id,
            orderId: order.id,
            userId: user.id,
            eventId: event.id,
            tierId: tier.id,
            source: 'purchase',
            status: 'valid',
          },
        });
      if (lowFirst) {
        await mk(LOW_ID);
        await mk(HIGH_ID);
      } else {
        await mk(HIGH_ID);
        await mk(LOW_ID);
      }
      await prisma.ticket.updateMany({
        where: { id: { in: [LOW_ID, HIGH_ID] } },
        data: { createdAt: TIED_AT },
      });

      const first = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
      const second = await issueTicketForPaidOrder(order.id, order.providerRef!, env);

      expect(first.ticketId).toBe(LOW_ID);
      expect(second.ticketId).toBe(LOW_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Stripe cart providerRef stamp (routes/stripe-webhook.ts).
  // ---------------------------------------------------------------------------
  //
  // The worst one. reserveAndCreateOrders writes every order of a cart inside
  // ONE transaction, so they all carry the same `createdAt`, and the handler
  // stamps the PaymentIntent id on `orders[0]`. charge.refunded and
  // charge.dispute.created both resolve the cart by (provider, providerRef); if
  // the stamp lands on a row a redelivery would not have chosen, a refund or a
  // chargeback cannot find the order and the tickets stay valid after the money
  // goes back.

  describe('POST /stripe/webhook — canonical cart order stamp', () => {
    let app: FastifyInstance;
    let stripe: FakeStripe;

    beforeEach(async () => {
      ({ app, stripe } = await makeAppWithFakeStripe());
    });

    afterEach(async () => {
      await app.close();
    });

    it.each([
      ['low id inserted last', false],
      ['low id inserted first', true],
    ])('stamps the PaymentIntent on the lowest-id cart order (%s)', async (_label, lowFirst) => {
      const { user } = await createUser({ verified: true });
      const cart = await prisma.cart.create({
        data: { userId: user.id, status: 'checking_out' },
      });
      const piId = `pi_cart_${Math.random().toString(36).slice(2, 10)}`;

      const mkOrder = async (id: string) => {
        const event = await seedEvent();
        const tier = await seedTier(event.id, { name: 'Geral', sortOrder: 0 });
        return prisma.order.create({
          data: {
            id,
            userId: user.id,
            eventId: event.id,
            tierId: tier.id,
            cartId: cart.id,
            kind: 'ticket',
            amountCents: 5000,
            quantity: 1,
            method: 'card',
            provider: 'stripe',
            providerRef: null,
            status: 'pending',
          },
        });
      };

      if (lowFirst) {
        await mkOrder(LOW_ID);
        await mkOrder(HIGH_ID);
      } else {
        await mkOrder(HIGH_ID);
        await mkOrder(LOW_ID);
      }
      await prisma.order.updateMany({
        where: { id: { in: [LOW_ID, HIGH_ID] } },
        data: { createdAt: TIED_AT },
      });

      stripe.nextEvent = {
        id: `evt_${Math.random().toString(36).slice(2, 10)}`,
        type: 'payment_intent.succeeded',
        livemode: false,
        data: { object: { id: piId, metadata: { cartId: cart.id } } },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(res.statusCode).toBe(200);

      const stamped = await prisma.order.findFirst({
        where: { provider: 'stripe', providerRef: piId },
        select: { id: true },
      });
      expect(stamped?.id).toBe(LOW_ID);
    });

    // -------------------------------------------------------------------------
    // 4a. The anchor must be a row that actually paid — reopened cart.
    // -------------------------------------------------------------------------
    //
    // `handleCartFailure` marks pending orders `failed` while KEEPING `cartId`,
    // then reopens the cart on a bumped version. So a reopened cart holds older
    // `failed` rows beside the row that later paid. The backfill branch used to
    // read `{ cartId }` with no status filter and, ordered oldest-first, stamp
    // the live PaymentIntent on one of those `failed` rows. Both cascades
    // require the anchor to be `paid`, so the refund then resolved a `failed`
    // row, the cascade was correctly suppressed, and the paid order's tickets
    // survived a full refund.

    it('backfills the stamp onto the paid order, not an older failed sibling', async () => {
      const { user } = await createUser({ verified: true });
      const cart = await prisma.cart.create({
        data: { userId: user.id, status: 'checking_out', version: 2 },
      });
      const piId = `pi_reopen_${Math.random().toString(36).slice(2, 10)}`;

      const mkOrder = async (o: { id: string; status: 'failed' | 'paid'; createdAt: Date }) => {
        const event = await seedEvent();
        const tier = await seedTier(event.id, { name: 'Geral', sortOrder: 0 });
        const order = await prisma.order.create({
          data: {
            id: o.id,
            userId: user.id,
            eventId: event.id,
            tierId: tier.id,
            cartId: cart.id,
            kind: 'ticket',
            amountCents: 5000,
            quantity: 1,
            method: 'card',
            provider: 'stripe',
            providerRef: null,
            status: o.status,
            ...(o.status === 'paid' ? { paidAt: new Date() } : { failedAt: new Date() }),
          },
        });
        await prisma.order.update({ where: { id: order.id }, data: { createdAt: o.createdAt } });
        if (o.status === 'paid') {
          await prisma.ticket.create({
            data: {
              orderId: order.id,
              userId: user.id,
              eventId: event.id,
              tierId: tier.id,
              source: 'purchase',
              status: 'valid',
            },
          });
        }
        return order;
      };

      // The failed row is OLDER, so oldest-first without a status filter picks
      // it. It also has the lower id, so a tiebreak alone does not save this.
      const failed = await mkOrder({
        id: LOW_ID,
        status: 'failed',
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
      });
      const paid = await mkOrder({
        id: HIGH_ID,
        status: 'paid',
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
      });

      stripe.nextEvent = {
        id: `evt_${Math.random().toString(36).slice(2, 10)}`,
        type: 'payment_intent.succeeded',
        livemode: false,
        data: { object: { id: piId, metadata: { cartId: cart.id } } },
      };
      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(res.statusCode).toBe(200);

      const stamped = await prisma.order.findFirst({
        where: { provider: 'stripe', providerRef: piId },
        select: { id: true },
      });
      expect(stamped?.id).toBe(paid.id);

      // The consequence, end to end: a full refund on this PI must revoke the
      // ticket. Anchored on the failed row it could not, because the cascade
      // gate requires the anchor to be `paid`.
      stripe.nextEvent = {
        id: `evt_ref_${Math.random().toString(36).slice(2, 10)}`,
        type: 'charge.refunded',
        livemode: false,
        data: {
          object: {
            id: 'ch_reopen',
            payment_intent: piId,
            amount: 5000,
            amount_refunded: 5000,
            refunded: true,
          },
        },
      };
      const refundRes = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(refundRes.statusCode).toBe(200);

      const tickets = await prisma.ticket.findMany({
        where: { orderId: paid.id },
        select: { status: true },
      });
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.status).toBe('revoked');
      void failed;
    });

    // -------------------------------------------------------------------------
    // 4b. The anchor must be a row that SURVIVED the settlement loop.
    // -------------------------------------------------------------------------
    //
    // The loop can take a row out of `paid` on its way through: a
    // duplicate-ticket failure partially refunds that order and flips it to
    // `refunded`. Anchoring before the loop could pick exactly that row. Adding
    // the id tiebreak made this RELIABLE rather than planner-dependent whenever
    // the lowest-id order was the one refunded — which is what this pins.

    it('anchors on an order that survived settlement, not one the loop refunded', async () => {
      const { user } = await createUser({ verified: true });
      const cart = await prisma.cart.create({
        data: { userId: user.id, status: 'checking_out' },
      });
      const piId = `pi_dup_${Math.random().toString(36).slice(2, 10)}`;

      // Event E caps at one ticket per user and the buyer already holds one, so
      // settling its order raises TicketAlreadyExistsForEventError.
      const eventE = await seedEvent({ maxTicketsPerUser: 1 });
      const tierE = await seedTier(eventE.id, { name: 'Geral E', sortOrder: 0 });
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: eventE.id,
          tierId: tierE.id,
          source: 'purchase',
          status: 'valid',
        },
      });

      const eventF = await seedEvent();
      const tierF = await seedTier(eventF.id, { name: 'Geral F', sortOrder: 0 });

      const mkOrder = (id: string, eventId: string, tierId: string) =>
        prisma.order.create({
          data: {
            id,
            userId: user.id,
            eventId,
            tierId,
            cartId: cart.id,
            kind: 'ticket',
            amountCents: 5000,
            quantity: 1,
            method: 'card',
            provider: 'stripe',
            providerRef: null,
            status: 'pending',
          },
        });

      // LOW_ID is the doomed one, so the pre-loop anchor picks precisely the
      // row the loop is about to refund.
      const doomed = await mkOrder(LOW_ID, eventE.id, tierE.id);
      const survivor = await mkOrder(HIGH_ID, eventF.id, tierF.id);
      await prisma.order.updateMany({
        where: { id: { in: [LOW_ID, HIGH_ID] } },
        data: { createdAt: TIED_AT },
      });

      stripe.nextEvent = {
        id: `evt_${Math.random().toString(36).slice(2, 10)}`,
        type: 'payment_intent.succeeded',
        livemode: false,
        data: { object: { id: piId, metadata: { cartId: cart.id } } },
      };
      const res = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
        payload: rawJson(stripe.nextEvent),
      });
      expect(res.statusCode).toBe(200);

      const rows = await prisma.order.findMany({
        where: { id: { in: [doomed.id, survivor.id] } },
        select: { id: true, status: true, providerRef: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(doomed.id)!.status).toBe('refunded');
      expect(byId.get(survivor.id)!.status).toBe('paid');

      // The stamp must be on the surviving paid row, or the refund cascade
      // below is dead.
      expect(byId.get(doomed.id)!.providerRef).toBeNull();
      expect(byId.get(survivor.id)!.providerRef).toBe(piId);
    });
  });
});
