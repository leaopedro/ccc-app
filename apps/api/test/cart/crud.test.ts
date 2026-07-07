import { prisma } from '@jdm/db';
import {
  getCartResponseSchema,
  upsertCartItemResponseSchema,
  clearCartResponseSchema,
} from '@jdm/shared/cart';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const errorSchema = z.object({ error: z.string(), message: z.string().optional() });

const seedPublishedEvent = async (opts?: {
  quantityTotal?: number;
  priceCents?: number;
  maxTicketsPerUser?: number;
}) => {
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
      maxTicketsPerUser: opts?.maxTicketsPerUser ?? 5,
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

const seedExtra = async (
  eventId: string,
  opts?: { priceCents?: number; quantityTotal?: number | null; active?: boolean },
) => {
  return prisma.ticketExtra.create({
    data: {
      eventId,
      name: `Extra ${Math.random().toString(36).slice(2, 6)}`,
      priceCents: opts?.priceCents ?? 1000,
      currency: 'BRL',
      quantityTotal: opts?.quantityTotal ?? 100,
      quantitySold: 0,
      active: opts?.active ?? true,
    },
  });
};

describe('Cart CRUD', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ---------- GET /cart ----------

  describe('GET /cart', () => {
    it('returns null cart when no active cart exists', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = getCartResponseSchema.parse(res.json());
      expect(body.cart).toBeNull();
      expect(body.stockWarnings).toEqual([]);
      expect(body.evictedItems).toEqual([]);
      expect(body.flags.cartV1).toBe(true);
    });

    it('returns existing open cart with items', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      // Add an item first
      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = getCartResponseSchema.parse(res.json());
      expect(body.cart).not.toBeNull();
      expect(body.cart!.items).toHaveLength(1);
      expect(body.cart!.items[0]!.eventId).toBe(event.id);
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/cart' });
      expect(res.statusCode).toBe(401);
    });

    it('evicts items for unpublished events', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });

      // Unpublish the event
      await prisma.event.update({ where: { id: event.id }, data: { status: 'draft' } });

      const res = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = getCartResponseSchema.parse(res.json());
      expect(body.evictedItems).toHaveLength(1);
      expect(body.evictedItems[0]!.reason).toBe('event_unpublished');
      // Cart should be empty after eviction
      if (body.cart) {
        expect(body.cart.items).toHaveLength(0);
      }
    });
  });

  // ---------- POST /cart/items ----------

  describe('POST /cart/items', () => {
    it('creates a cart and adds an item', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ priceCents: 5000 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 2,
            tickets: [{}, {}],
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.items).toHaveLength(1);
      expect(body.cart.items[0]!.quantity).toBe(2);
      expect(body.cart.items[0]!.amountCents).toBe(10000);
      expect(body.cart.status).toBe('open');
      expect(body.cart.version).toBe(1);
    });

    it('adds item with extras', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ priceCents: 5000 });
      const extra = await seedExtra(event.id, { priceCents: 1500 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            tickets: [{ extras: [extra.id] }],
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.items[0]!.extras).toHaveLength(1);
      expect(body.cart.items[0]!.extras[0]!.extraId).toBe(extra.id);
      expect(body.cart.items[0]!.extras[0]!.unitPriceCents).toBe(1500);
      expect(body.cart.items[0]!.extras[0]!.quantity).toBe(1);
      // Total = tier price + extra price
      expect(body.cart.items[0]!.amountCents).toBe(6500);
    });

    it('rejects when tier is sold out', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ quantityTotal: 5 });

      // Sell out the tier
      await prisma.ticketTier.update({
        where: { id: tier.id },
        data: { quantitySold: 5 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] },
        },
      });
      expect(res.statusCode).toBe(409);
      const body = errorSchema.parse(res.json());
      expect(body.error).toBe('SoldOut');
    });

    it('rejects when quantity exceeds available stock', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ quantityTotal: 3 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: event.id, tierId: tier.id, quantity: 4, tickets: [{}, {}, {}, {}] },
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects when event is not published', async () => {
      const { user } = await createUser({ verified: true });
      const event = await prisma.event.create({
        data: {
          slug: 'draft-event',
          title: 'Draft',
          description: 'Draft event',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          type: 'meeting',
          status: 'draft',
          capacity: 100,
        },
      });
      const tier = await prisma.ticketTier.create({
        data: { eventId: event.id, name: 'Geral', priceCents: 5000, quantityTotal: 50 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] },
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects when quantity exceeds maxTicketsPerUser', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ maxTicketsPerUser: 2 });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: event.id, tierId: tier.id, quantity: 3, tickets: [{}, {}, {}] },
        },
      });
      expect(res.statusCode).toBe(409);
      const body = errorSchema.extend({ code: z.string().optional() }).parse(res.json());
      expect(body.code).toBe('MAX_TICKETS_EXCEEDED');
      expect(body.message).toMatch(/max 2 ticket/i);
    });

    it('rejects when tickets array length does not match quantity', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: event.id, tierId: tier.id, quantity: 2, tickets: [{}] },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('reuses existing open cart', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();
      const e2 = await seedPublishedEvent();

      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: e2.event.id, tierId: e2.tier.id, quantity: 1, tickets: [{}] } },
      });
      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.items).toHaveLength(2);
    });
  });

  // ---------- PATCH /cart/items/:itemId ----------

  describe('PATCH /cart/items/:itemId', () => {
    it('updates an existing cart item quantity', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ priceCents: 5000 });

      const addRes = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });
      const itemId = upsertCartItemResponseSchema.parse(addRes.json()).cart.items[0]!.id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/cart/items/${itemId}`,
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: event.id, tierId: tier.id, quantity: 3, tickets: [{}, {}, {}] },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.items[0]!.quantity).toBe(3);
      expect(body.cart.items[0]!.amountCents).toBe(15000);
    });

    it('returns 404 for non-existent item', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      // Create a cart first
      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/cart/items/nonexistent-id',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });
      expect(res.statusCode).toBe(404);
    });

    it('bumps cart version on update', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      const addRes = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });
      const addBody = upsertCartItemResponseSchema.parse(addRes.json());
      const itemId = addBody.cart.items[0]!.id;
      const v1 = addBody.cart.version;

      const res = await app.inject({
        method: 'PATCH',
        url: `/cart/items/${itemId}`,
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 2, tickets: [{}, {}] } },
      });
      const body = upsertCartItemResponseSchema.parse(res.json());
      expect(body.cart.version).toBeGreaterThan(v1);
    });
  });

  // ---------- DELETE /cart/items/:itemId ----------

  describe('DELETE /cart/items/:itemId', () => {
    it('removes a single item from the cart', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      const addRes = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });
      const itemId = upsertCartItemResponseSchema.parse(addRes.json()).cart.items[0]!.id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/cart/items/${itemId}`,
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = clearCartResponseSchema.parse(res.json());
      expect(body.ok).toBe(true);

      // Verify cart is now empty
      const getRes = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      const getBody = getCartResponseSchema.parse(getRes.json());
      if (getBody.cart) {
        expect(getBody.cart.items).toHaveLength(0);
      }
    });

    it('returns 404 for item not in user cart', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'DELETE',
        url: '/cart/items/nonexistent',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ---------- DELETE /cart ----------

  describe('DELETE /cart', () => {
    it('clears the entire cart', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();

      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = clearCartResponseSchema.parse(res.json());
      expect(body.ok).toBe(true);

      // Verify cart is gone
      const getRes = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      const getBody = getCartResponseSchema.parse(getRes.json());
      expect(getBody.cart).toBeNull();
    });

    it('returns ok even if no cart exists', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'DELETE',
        url: '/cart',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = clearCartResponseSchema.parse(res.json());
      expect(body.ok).toBe(true);
    });
  });

  // ---------- Totals ----------

  describe('cart totals', () => {
    it('computes correct totals across multiple items', async () => {
      const { user } = await createUser({ verified: true });
      const ev1 = await seedPublishedEvent({ priceCents: 5000 });
      const ev2 = await seedPublishedEvent({ priceCents: 3000 });

      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: ev1.event.id, tierId: ev1.tier.id, quantity: 2, tickets: [{}, {}] },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: { eventId: ev2.event.id, tierId: ev2.tier.id, quantity: 1, tickets: [{}] },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = upsertCartItemResponseSchema.parse(res.json());
      // 2*5000 + 1*3000 = 13000 base; +10% dev fee = 14300 gross
      expect(body.cart.totals.amountCents).toBe(14300);
      expect(body.cart.totals.ticketSubtotalCents).toBe(13000);
      expect(body.cart.totals.currency).toBe('BRL');
    });
  });

  // ---------- Concurrency ----------

  describe('concurrency safety', () => {
    it('handles concurrent adds without duplicating cart', async () => {
      const { user } = await createUser({ verified: true });
      const ev1 = await seedPublishedEvent();
      const ev2 = await seedPublishedEvent();

      const [r1, r2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/cart/items',
          headers: { authorization: bearer(env, user.id) },
          payload: {
            item: { eventId: ev1.event.id, tierId: ev1.tier.id, quantity: 1, tickets: [{}] },
          },
        }),
        app.inject({
          method: 'POST',
          url: '/cart/items',
          headers: { authorization: bearer(env, user.id) },
          payload: {
            item: { eventId: ev2.event.id, tierId: ev2.tier.id, quantity: 1, tickets: [{}] },
          },
        }),
      ]);

      // Both should succeed
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);

      // Only one cart should exist
      const carts = await prisma.cart.findMany({ where: { userId: user.id, status: 'open' } });
      expect(carts).toHaveLength(1);
    });
  });

  // ---------- Cross-user isolation ----------

  describe('cross-user isolation', () => {
    it('users cannot see each other carts', async () => {
      const { user: alice } = await createUser({ email: 'alice@jdm.test', verified: true });
      const { user: bob } = await createUser({ email: 'bob@jdm.test', verified: true });
      const { event, tier } = await seedPublishedEvent();

      await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, alice.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });

      const bobCart = await app.inject({
        method: 'GET',
        url: '/cart',
        headers: { authorization: bearer(env, bob.id) },
      });
      expect(bobCart.statusCode).toBe(200);
      const body = getCartResponseSchema.parse(bobCart.json());
      expect(body.cart).toBeNull();
    });

    it('users cannot delete each other cart items', async () => {
      const { user: alice } = await createUser({ email: 'alice@jdm.test', verified: true });
      const { user: bob } = await createUser({ email: 'bob@jdm.test', verified: true });
      const { event, tier } = await seedPublishedEvent();

      const addRes = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, alice.id) },
        payload: { item: { eventId: event.id, tierId: tier.id, quantity: 1, tickets: [{}] } },
      });
      const itemId = upsertCartItemResponseSchema.parse(addRes.json()).cart.items[0]!.id;

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/cart/items/${itemId}`,
        headers: { authorization: bearer(env, bob.id) },
      });
      expect(delRes.statusCode).toBe(404);
    });
  });

  // ---------- CTO review regressions ----------

  describe('CTO review regressions', () => {
    it('PATCH extras_only item excludes tier price from amount', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent({ priceCents: 5000 });
      const extra = await seedExtra(event.id, { priceCents: 2000 });

      const addRes = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            kind: 'extras_only',
            tickets: [{ extras: [extra.id] }],
          },
        },
      });
      expect(addRes.statusCode).toBe(200);
      const addedItem = upsertCartItemResponseSchema.parse(addRes.json()).cart.items[0]!;
      expect(addedItem.amountCents).toBe(2000);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/cart/items/${addedItem.id}`,
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            kind: 'extras_only',
            tickets: [{ extras: [extra.id] }],
          },
        },
      });
      expect(patchRes.statusCode).toBe(200);
      const patchedItem = upsertCartItemResponseSchema.parse(patchRes.json()).cart.items[0]!;
      expect(patchedItem.amountCents).toBe(2000);
    });

    it('POST rejects deleted extra instead of pricing at zero', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();
      const extra = await seedExtra(event.id, { priceCents: 1000 });

      await prisma.ticketExtra.delete({ where: { id: extra.id } });

      const res = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            tickets: [{ extras: [extra.id] }],
          },
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('PATCH rejects deleted extra instead of pricing at zero', async () => {
      const { user } = await createUser({ verified: true });
      const { event, tier } = await seedPublishedEvent();
      const extra1 = await seedExtra(event.id, { priceCents: 1000 });
      const extra2 = await seedExtra(event.id, { priceCents: 2000 });

      const addRes = await app.inject({
        method: 'POST',
        url: '/cart/items',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            tickets: [{ extras: [extra1.id] }],
          },
        },
      });
      const itemId = upsertCartItemResponseSchema.parse(addRes.json()).cart.items[0]!.id;

      await prisma.ticketExtra.delete({ where: { id: extra2.id } });

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/cart/items/${itemId}`,
        headers: { authorization: bearer(env, user.id) },
        payload: {
          item: {
            eventId: event.id,
            tierId: tier.id,
            quantity: 1,
            tickets: [{ extras: [extra2.id] }],
          },
        },
      });
      expect(patchRes.statusCode).toBeGreaterThanOrEqual(400);
      expect(patchRes.statusCode).toBeLessThan(500);
    });
  });
});
