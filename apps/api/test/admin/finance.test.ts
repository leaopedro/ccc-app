import { randomUUID } from 'node:crypto';

import { prisma } from '@ccc/db';
import {
  adminFinanceByEventResponseSchema,
  adminFinanceByProductResponseSchema,
  adminFinancePaymentMixResponseSchema,
  adminFinanceSummarySchema,
  adminFinanceTrendResponseSchema,
} from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

async function seedEvent(slug: string, city = 'São Paulo', stateCode = 'SP') {
  return prisma.event.create({
    data: {
      slug,
      title: `Evento ${slug}`,
      description: 'desc',
      startsAt: new Date('2026-06-01T19:00:00Z'),
      endsAt: new Date('2026-06-01T23:00:00Z'),
      venueName: 'v',
      venueAddress: 'a',
      city,
      stateCode,
      type: 'meeting',
      capacity: 100,
      status: 'published',
      publishedAt: new Date(),
    },
  });
}

async function seedTier(eventId: string, priceCents = 5000) {
  return prisma.ticketTier.create({
    data: {
      eventId,
      name: 'Standard',
      priceCents,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      sortOrder: 0,
    },
  });
}

async function seedExtra(eventId: string, priceCents = 2000) {
  return prisma.ticketExtra.create({
    data: {
      eventId,
      name: 'Estacionamento',
      priceCents,
      quantityTotal: null,
      active: true,
    },
  });
}

type SeedOrderItemInput =
  | {
      kind: 'ticket';
      tierId: string;
      quantity?: number;
      unitPriceCents: number;
      subtotalCents?: number;
    }
  | {
      kind: 'extras';
      extraId: string;
      quantity?: number;
      unitPriceCents: number;
      subtotalCents?: number;
    }
  | {
      kind: 'product';
      variantId?: string | null;
      quantity?: number;
      unitPriceCents: number;
      subtotalCents?: number;
    };

async function seedOrder(
  userId: string,
  eventId: string | null,
  tierId: string | null,
  overrides: Partial<{
    amountCents: number;
    baseAmountCents: number;
    devFeePercent: number;
    devFeeAmountCents: number;
    method: 'card' | 'pix';
    provider: 'stripe' | 'abacatepay';
    status: 'paid' | 'refunded' | 'pending';
    paidAt: Date | null;
    refundedAt: Date | null;
    kind: 'ticket' | 'extras_only' | 'product' | 'mixed';
    orderItems: SeedOrderItemInput[];
  }> = {},
): Promise<{ id: string }> {
  const orderItems = overrides.orderItems ?? [];
  const amountCents =
    overrides.amountCents ??
    (orderItems.length > 0
      ? orderItems.reduce(
          (sum, item) => sum + (item.subtotalCents ?? item.unitPriceCents * (item.quantity ?? 1)),
          0,
        )
      : 5000);

  const providerRef = `pi_${Math.random().toString(36).slice(2)}`;
  const status = overrides.status ?? 'paid';
  const method = overrides.method ?? 'card';
  const provider = overrides.provider ?? 'stripe';
  const kind = overrides.kind ?? 'ticket';
  const paidAt = overrides.paidAt ?? new Date('2026-05-01T12:00:00Z');
  const refundedAt = overrides.refundedAt ?? null;
  const devFeePercent = overrides.devFeePercent ?? 0;
  const devFeeAmountCents = overrides.devFeeAmountCents ?? 0;
  const baseAmountCents = overrides.baseAmountCents ?? amountCents - devFeeAmountCents;

  const order =
    eventId === null && tierId === null
      ? await (async () => {
          const orderId = randomUUID();
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Order" ("id", "userId", "eventId", "tierId", "kind", "amountCents", "baseAmountCents", "devFeePercent", "devFeeAmountCents", "currency", "method", "provider", "providerRef", "quantity", "status", "paidAt", "refundedAt", "createdAt", "updatedAt")
             VALUES ($1, $2, NULL, NULL, $3::"OrderKind", $4, $5, $6, $7, $8, $9::"PaymentMethod", $10::"PaymentProvider", $11, 1, $12::"OrderStatus", $13, $14, NOW(), NOW())`,
            orderId,
            userId,
            kind,
            amountCents,
            baseAmountCents,
            devFeePercent,
            devFeeAmountCents,
            'BRL',
            method,
            provider,
            providerRef,
            status,
            paidAt,
            refundedAt,
          );
          return { id: orderId };
        })()
      : await prisma.order.create({
          data: {
            userId,
            eventId,
            tierId,
            kind,
            amountCents,
            baseAmountCents,
            devFeePercent,
            devFeeAmountCents,
            currency: 'BRL',
            method,
            provider,
            status,
            paidAt,
            refundedAt,
            providerRef,
          },
        });

  if (orderItems.length > 0) {
    for (const item of orderItems) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "OrderItem" ("id", "orderId", "kind", "variantId", "tierId", "extraId", "quantity", "unitPriceCents", "subtotalCents", "createdAt")
         VALUES ($1, $2, $3::"OrderItemKind", $4, $5, $6, $7, $8, $9, NOW())`,
        randomUUID(),
        order.id,
        item.kind,
        item.kind === 'product' ? (item.variantId ?? null) : null,
        item.kind === 'ticket' ? item.tierId : null,
        item.kind === 'extras' ? item.extraId : null,
        item.quantity ?? 1,
        item.unitPriceCents,
        item.subtotalCents ?? item.unitPriceCents * (item.quantity ?? 1),
      );
    }
  }

  return order;
}

async function seedBulkStandaloneOrders({
  userId,
  count,
  amountCents,
  kind = 'product',
  method = 'card',
  provider = 'stripe',
  status = 'paid',
  paidAt = new Date('2026-05-01T12:00:00Z'),
}: {
  userId: string;
  count: number;
  amountCents: number;
  kind?: 'ticket' | 'extras_only' | 'product' | 'mixed';
  method?: 'card' | 'pix';
  provider?: 'stripe' | 'abacatepay';
  status?: 'paid' | 'refunded' | 'pending';
  paidAt?: Date;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Order" ("id", "userId", "eventId", "tierId", "kind", "amountCents", "baseAmountCents", "devFeePercent", "devFeeAmountCents", "currency", "method", "provider", "providerRef", "quantity", "status", "paidAt", "refundedAt", "createdAt", "updatedAt")
     SELECT
       ('00000000-0000-0000-0000-' || LPAD(gs::text, 12, '0'))::uuid,
       $1,
       NULL,
       NULL,
       $2::"OrderKind",
       $3,
       $3,
       0,
       0,
       'BRL',
       $4::"PaymentMethod",
       $5::"PaymentProvider",
       CONCAT('bulk-', gs),
       1,
       $6::"OrderStatus",
       $7,
       NULL,
       $7,
       $7
     FROM generate_series(1, $8) AS gs`,
    userId,
    kind,
    amountCents,
    method,
    provider,
    status,
    paidAt,
    count,
  );
}

describe('Admin Finance Endpoints', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /admin/finance/summary', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/finance/summary' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for user role', async () => {
      const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary',
        headers: { authorization: bearer(env, user.id, 'user') },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns zero-state when no orders exist', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(0);
      expect(body.netRevenueCents).toBe(0);
      expect(body.orderCount).toBe(0);
      expect(body.avgOrderCents).toBe(0);
      expect(body.ticketCount).toBe(0);
      expect(body.refundedCents).toBe(0);
      expect(body.refundedCount).toBe(0);
    });

    it('computes summary from paid orders', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 10000, status: 'paid' });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 5000, status: 'paid' });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 3000, status: 'refunded' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(15000);
      expect(body.orderCount).toBe(2);
      expect(body.avgOrderCents).toBe(7500);
      expect(body.refundedCents).toBe(3000);
      expect(body.refundedCount).toBe(1);
      expect(body.netRevenueCents).toBe(12000);
    });

    it('prefers order item revenue and falls back to legacy order amounts', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id, 10000);
      const extra = await seedExtra(event.id, 2000);
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 99000,
        orderItems: [
          { kind: 'ticket', tierId: tier.id, unitPriceCents: 10000 },
          { kind: 'extras', extraId: extra.id, unitPriceCents: 2000 },
        ],
      });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 7000 });
      await seedOrder(buyer.id, null, null, {
        kind: 'product',
        orderItems: [{ kind: 'product', unitPriceCents: 5000 }],
      });
      await seedOrder(buyer.id, null, null, {
        kind: 'product',
        amountCents: 42000,
        status: 'refunded',
        orderItems: [{ kind: 'product', unitPriceCents: 4500 }],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(24000);
      expect(body.orderCount).toBe(3);
      expect(body.avgOrderCents).toBe(8000);
      expect(body.refundedCents).toBe(4500);
      expect(body.refundedCount).toBe(1);
      expect(body.storeRevenueCents).toBe(5000);
      expect(body.storeOrderCount).toBe(1);
      expect(body.netRevenueCents).toBe(19500);
    });

    it('filters by date range', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 10000,
        paidAt: new Date('2026-04-01T12:00:00Z'),
      });
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 5000,
        paidAt: new Date('2026-05-15T12:00:00Z'),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary?from=2026-05-01&to=2026-05-31',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(5000);
      expect(body.orderCount).toBe(1);
    });

    it('refund-this-month for paid-last-month appears in refundedCents when filtering by date', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      // Paid in April, still active — should appear in April filter only
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 10000,
        status: 'paid',
        paidAt: new Date('2026-04-15T12:00:00Z'),
      });
      // Paid in April, refunded in May — should appear in May refundedCents
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 3000,
        status: 'refunded',
        paidAt: new Date('2026-04-10T12:00:00Z'),
        refundedAt: new Date('2026-05-05T12:00:00Z'),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary?from=2026-05-01&to=2026-05-31',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(0);
      expect(body.refundedCents).toBe(3000);
      expect(body.refundedCount).toBe(1);
    });

    it('filters by provider', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 10000, provider: 'stripe' });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 5000, provider: 'abacatepay' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary?provider=stripe',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(10000);
    });

    it('filters by eventIds', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event1 = await seedEvent('meet-sp', 'São Paulo', 'SP');
      const event2 = await seedEvent('meet-rj', 'Rio de Janeiro', 'RJ');
      const tier1 = await seedTier(event1.id);
      const tier2 = await seedTier(event2.id);

      await seedOrder(buyer.id, event1.id, tier1.id, { amountCents: 10000 });
      await seedOrder(buyer.id, event2.id, tier2.id, { amountCents: 5000 });

      const res = await app.inject({
        method: 'GET',
        url: `/admin/finance/summary?eventIds=${event1.id}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(10000);
      expect(body.orderCount).toBe(1);
    });

    it('filters by method', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 10000, method: 'card' });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 5000, method: 'pix' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary?method=pix',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(5000);
    });

    it('reports dev-fee snapshot totals from paid orders and nets refunded fees', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 11000,
        baseAmountCents: 10000,
        devFeePercent: 10,
        devFeeAmountCents: 1000,
        status: 'paid',
      });
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 5500,
        baseAmountCents: 5000,
        devFeePercent: 10,
        devFeeAmountCents: 500,
        status: 'paid',
      });
      // Legacy order snapshotted with no fee — must stay zero (no retroactive imputation).
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 3000,
        baseAmountCents: 3000,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        status: 'paid',
      });
      // Refunded paid order — its fee comes out of the collected total.
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 2200,
        baseAmountCents: 2000,
        devFeePercent: 10,
        devFeeAmountCents: 200,
        status: 'refunded',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.devFeePercent).toBe(10);
      // 1000 + 500 + 0 collected − 200 refunded = 1300.
      expect(body.devFeeCollectedCents).toBe(1300);
    });

    it('netRevenueCents goes negative when refunds exceed paid revenue in window', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 1000, status: 'paid' });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 5000, status: 'refunded' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/summary',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceSummarySchema.parse(res.json());
      expect(body.totalRevenueCents).toBe(1000);
      expect(body.refundedCents).toBe(5000);
      expect(body.netRevenueCents).toBe(-4000);
    });
  });

  describe('GET /admin/finance/by-event', () => {
    it('returns empty array when no orders', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-event',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByEventResponseSchema.parse(res.json());
      expect(body.items).toEqual([]);
    });

    it('groups revenue by event', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event1 = await seedEvent('meet-sp', 'São Paulo', 'SP');
      const event2 = await seedEvent('meet-rj', 'Rio de Janeiro', 'RJ');
      const tier1 = await seedTier(event1.id);
      const tier2 = await seedTier(event2.id);

      await seedOrder(buyer.id, event1.id, tier1.id, { amountCents: 10000 });
      await seedOrder(buyer.id, event1.id, tier1.id, { amountCents: 5000 });
      await seedOrder(buyer.id, event2.id, tier2.id, { amountCents: 8000 });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-event',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByEventResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);
      // Sorted by revenue descending
      const first = body.items[0]!;
      const second = body.items[1]!;
      expect(first.revenueCents).toBe(15000);
      expect(first.eventTitle).toBe('Evento meet-sp');
      expect(second.revenueCents).toBe(8000);
    });

    it('filters by city', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event1 = await seedEvent('meet-sp', 'São Paulo', 'SP');
      const event2 = await seedEvent('meet-rj', 'Rio de Janeiro', 'RJ');
      const tier1 = await seedTier(event1.id);
      const tier2 = await seedTier(event2.id);

      await seedOrder(buyer.id, event1.id, tier1.id, { amountCents: 10000 });
      await seedOrder(buyer.id, event2.id, tier2.id, { amountCents: 8000 });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-event?city=S%C3%A3o%20Paulo',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByEventResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.city).toBe('São Paulo');
    });

    it('reports revenueCents from paid only, refundedCents separately', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 10000, status: 'paid' });
      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 3000, status: 'refunded' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-event',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByEventResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      const row = body.items[0]!;
      expect(row.revenueCents).toBe(10000);
      expect(row.refundedCents).toBe(3000);
      expect(row.orderCount).toBe(1);
    });

    it('groups event revenue from order items and skips store-only orders', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event1 = await seedEvent('meet-sp');
      const event2 = await seedEvent('meet-rj', 'Rio de Janeiro', 'RJ');
      const tier1 = await seedTier(event1.id, 10000);
      const tier2 = await seedTier(event2.id, 8000);
      const extra = await seedExtra(event1.id, 2000);
      await seedOrder(buyer.id, event1.id, tier1.id, {
        amountCents: 99999,
        orderItems: [
          { kind: 'ticket', tierId: tier1.id, unitPriceCents: 10000 },
          { kind: 'extras', extraId: extra.id, unitPriceCents: 2000 },
        ],
      });
      await seedOrder(buyer.id, event1.id, tier1.id, {
        amountCents: 1000,
        status: 'refunded',
        orderItems: [{ kind: 'extras', extraId: extra.id, unitPriceCents: 2000 }],
      });
      await seedOrder(buyer.id, event2.id, tier2.id, { amountCents: 8000 });
      await seedOrder(buyer.id, null, null, {
        kind: 'product',
        orderItems: [{ kind: 'product', unitPriceCents: 5000 }],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-event',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByEventResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);
      const first = body.items[0]!;
      const second = body.items[1]!;
      expect(first.eventId).toBe(event1.id);
      expect(first.revenueCents).toBe(12000);
      expect(first.refundedCents).toBe(2000);
      expect(second.eventId).toBe(event2.id);
      expect(second.revenueCents).toBe(8000);
    });
  });

  describe('GET /admin/finance/trends', () => {
    it('returns empty points with no orders', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/trends',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceTrendResponseSchema.parse(res.json());
      expect(body.points).toEqual([]);
    });

    it('buckets orders by day', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 10000,
        paidAt: new Date('2026-05-01T10:00:00Z'),
      });
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 5000,
        paidAt: new Date('2026-05-01T14:00:00Z'),
      });
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 3000,
        paidAt: new Date('2026-05-02T09:00:00Z'),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/trends',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceTrendResponseSchema.parse(res.json());
      expect(body.points).toHaveLength(2);
      expect(body.points[0]!).toEqual({
        date: '2026-05-01',
        revenueCents: 15000,
        orderCount: 2,
        ticketRevenueCents: 15000,
        storeRevenueCents: 0,
        membershipRevenueCents: 0,
      });
      expect(body.points[1]!).toEqual({
        date: '2026-05-02',
        revenueCents: 3000,
        orderCount: 1,
        ticketRevenueCents: 3000,
        storeRevenueCents: 0,
        membershipRevenueCents: 0,
      });
    });

    it('uses order item subtotals in trend buckets', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id, 10000);
      const extra = await seedExtra(event.id, 1500);

      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 88888,
        paidAt: new Date('2026-05-03T10:00:00Z'),
        orderItems: [
          { kind: 'ticket', tierId: tier.id, unitPriceCents: 10000 },
          { kind: 'extras', extraId: extra.id, unitPriceCents: 1500 },
        ],
      });
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 5000,
        paidAt: new Date('2026-05-03T14:00:00Z'),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/trends',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceTrendResponseSchema.parse(res.json());
      expect(body.points).toEqual([
        {
          date: '2026-05-03',
          revenueCents: 16500,
          orderCount: 2,
          ticketRevenueCents: 16500,
          storeRevenueCents: 0,
          membershipRevenueCents: 0,
        },
      ]);
    });
  });

  describe('GET /admin/finance/payment-mix', () => {
    it('returns empty items with no orders', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/payment-mix',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinancePaymentMixResponseSchema.parse(res.json());
      expect(body.items).toEqual([]);
    });

    it('groups by provider and method with percentage', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 10000,
        provider: 'stripe',
        method: 'card',
      });
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 10000,
        provider: 'abacatepay',
        method: 'pix',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/payment-mix',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinancePaymentMixResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        expect(item.percentage).toBe(50);
        expect(item.revenueCents).toBe(10000);
        expect(item.orderCount).toBe(1);
      }
    });

    it('uses order item subtotals for payment mix revenue', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id, 10000);
      const extra = await seedExtra(event.id, 2000);
      await seedOrder(buyer.id, event.id, tier.id, {
        amountCents: 123456,
        provider: 'stripe',
        method: 'card',
        orderItems: [
          { kind: 'ticket', tierId: tier.id, unitPriceCents: 10000 },
          { kind: 'extras', extraId: extra.id, unitPriceCents: 2000 },
        ],
      });
      await seedOrder(buyer.id, null, null, {
        kind: 'product',
        provider: 'abacatepay',
        method: 'pix',
        orderItems: [{ kind: 'product', unitPriceCents: 6000 }],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/payment-mix',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinancePaymentMixResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);

      const stripe = body.items.find((item) => item.provider === 'stripe');
      const pix = body.items.find((item) => item.provider === 'abacatepay');
      expect(stripe).toMatchObject({
        provider: 'stripe',
        method: 'card',
        revenueCents: 12000,
        orderCount: 1,
      });
      expect(pix).toMatchObject({
        provider: 'abacatepay',
        method: 'pix',
        revenueCents: 6000,
        orderCount: 1,
      });
    });
  });

  describe('GET /admin/finance/by-product', () => {
    it('returns empty items when no product orders exist', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-product',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByProductResponseSchema.parse(res.json());
      expect(body.items).toEqual([]);
    });

    it('groups product revenue by product', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });

      const productType = await prisma.productType.create({ data: { name: 'Camiseta' } });
      const product1 = await prisma.product.create({
        data: {
          slug: 'camiseta-preta',
          title: 'Camiseta Preta',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 5000,
          status: 'active',
        },
      });
      const product2 = await prisma.product.create({
        data: {
          slug: 'bone-jdm',
          title: 'Boné JDM',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 3000,
          status: 'active',
        },
      });
      const variant1 = await prisma.variant.create({
        data: {
          productId: product1.id,
          name: 'M',
          priceCents: 5000,
          quantityTotal: 10,
          attributes: {},
        },
      });
      const variant2 = await prisma.variant.create({
        data: {
          productId: product2.id,
          name: 'Único',
          priceCents: 3000,
          quantityTotal: 10,
          attributes: {},
        },
      });

      await seedOrder(buyer.id, null, null, {
        kind: 'product',
        orderItems: [{ kind: 'product', variantId: variant1.id, unitPriceCents: 5000 }],
      });
      await seedOrder(buyer.id, null, null, {
        kind: 'product',
        orderItems: [
          { kind: 'product', variantId: variant1.id, unitPriceCents: 5000 },
          { kind: 'product', variantId: variant2.id, unitPriceCents: 3000 },
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-product',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByProductResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);

      const shirt = body.items.find((i) => i.productId === product1.id);
      const cap = body.items.find((i) => i.productId === product2.id);

      expect(shirt).toMatchObject({
        productTitle: 'Camiseta Preta',
        orderCount: 2,
        quantitySold: 2,
        revenueCents: 10000,
      });
      expect(cap).toMatchObject({
        productTitle: 'Boné JDM',
        orderCount: 1,
        quantitySold: 1,
        revenueCents: 3000,
      });
    });

    it('excludes ticket-only orders from by-product', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      await seedOrder(buyer.id, event.id, tier.id, { amountCents: 10000 });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/by-product',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = adminFinanceByProductResponseSchema.parse(res.json());
      expect(body.items).toEqual([]);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/finance/by-product' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /admin/finance/export', () => {
    it('returns CSV content type', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('finance-export.csv');
      expect(res.headers['x-ccc-k-anonymity-min']).toBe('5');
      expect(res.headers['x-ccc-k-anonymity-suppressed-groups']).toBe('0');
    });

    it('emits aggregate rows without direct identifiers', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `buyer-${i}@jdm.test`,
          name: `Buyer ${i}`,
          verified: true,
        });
        await seedOrder(user.id, event.id, tier.id, { amountCents: 10000 });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const lines = res.body.split('\n');
      // Header carries the F8.14 membership columns in addition to the base order columns.
      expect(lines[0]).toBe(
        'event,city,state,currency,method,provider,status,kind,product_or_collection,order_count,total_amount_cents,total_quantity,first_order_at,last_order_at,cadence,is_membership,membership_invoice_id',
      );
      expect(lines).toHaveLength(2); // header + 1 row
      expect(lines[0]).not.toContain('user_name');
      expect(lines[0]).not.toContain('user_email');
      expect(lines[1]).toContain('50000');
      expect(lines[1]).toContain('Evento meet-sp');
      expect(lines[1]).toContain(',5,50000,5,');
      expect(lines[1]).not.toContain('buyer-0@jdm.test');
      expect(lines[1]).not.toContain('Buyer 0');
    });

    it('respects filters', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `stripe-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, event.id, tier.id, {
          amountCents: 10000,
          provider: 'stripe',
          method: 'card',
        });
      }

      for (let i = 0; i < 4; i += 1) {
        const { user } = await createUser({
          email: `pix-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, event.id, tier.id, {
          amountCents: 5000,
          provider: 'abacatepay',
          method: 'pix',
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export?provider=stripe',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const lines = res.body.split('\n');
      expect(lines).toHaveLength(2); // header + 1 aggregate row
      expect(lines[1]).toContain('stripe');
      expect(lines[1]).toContain(',5,50000,5,');
      expect(lines[1]).not.toContain('abacatepay');

      const suppressed = await app.inject({
        method: 'GET',
        url: '/admin/finance/export?provider=abacatepay',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(suppressed.statusCode).toBe(200);
      expect(suppressed.body.split('\n')).toHaveLength(1);
      expect(suppressed.headers['x-ccc-k-anonymity-suppressed-groups']).toBe('1');
    });

    it('escapes aggregate CSV fields with commas', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const event = await seedEvent('meet-sp');
      await prisma.event.update({
        where: { id: event.id },
        data: { title: 'Evento, Especial' },
      });
      const tier = await seedTier(event.id);

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `buyer-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, event.id, tier.id, { amountCents: 5000 });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('"Evento, Especial"');
    });

    it('includes kind and product_or_collection for aggregate product cohorts', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const event = await seedEvent('meet-sp');
      const tier = await seedTier(event.id);

      const productType = await prisma.productType.create({
        data: { name: 'Tipo', sortOrder: 0 },
      });
      const product = await prisma.product.create({
        data: {
          slug: 'camiseta-test',
          title: 'Camiseta JDM',
          description: 'desc',
          productTypeId: productType.id,
          basePriceCents: 3000,
          status: 'active',
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'M',
          priceCents: 3000,
          quantityTotal: 10,
          quantitySold: 0,
          attributes: {},
        },
      });

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `product-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, null, null, {
          kind: 'product',
          amountCents: 3000,
          orderItems: [{ kind: 'product', variantId: variant.id, unitPriceCents: 3000 }],
        });
      }

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `ticket-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, event.id, tier.id, {
          kind: 'ticket',
          amountCents: 5000,
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const lines = res.body.split('\n');
      const productLine = lines.find((l) => l.includes(',product,'));
      const ticketLine = lines.find((l) => l.includes(',ticket,'));
      expect(productLine).toBeDefined();
      expect(ticketLine).toBeDefined();
      expect(productLine).toContain(',product,Camiseta JDM,5,15000,5,');
      expect(ticketLine).toContain(',ticket,,5,25000,5,');
    });

    it('keeps same-label events in separate cohorts by stable identifiers', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const eventA = await seedEvent('meet-a');
      const eventB = await seedEvent('meet-b');
      await prisma.event.update({
        where: { id: eventB.id },
        data: {
          title: eventA.title,
          city: eventA.city,
          stateCode: eventA.stateCode,
        },
      });
      const tierA = await seedTier(eventA.id, 5000);
      const tierB = await seedTier(eventB.id, 7000);

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `same-label-a-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, eventA.id, tierA.id, { amountCents: 5000 });
      }

      for (let i = 0; i < 5; i += 1) {
        const { user } = await createUser({
          email: `same-label-b-${i}@jdm.test`,
          verified: true,
        });
        await seedOrder(user.id, eventB.id, tierB.id, { amountCents: 7000 });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const lines = res.body.split('\n');
      expect(lines).toHaveLength(3);
      const sameLabelRows = lines.filter((line) =>
        line.includes('Evento meet-a,São Paulo,SP,BRL,card,stripe,paid,ticket'),
      );
      expect(sameLabelRows).toHaveLength(2);
      expect(sameLabelRows[0]).not.toBe(sameLabelRows[1]);
      expect(sameLabelRows).toEqual(
        expect.arrayContaining([
          expect.stringContaining(',5,25000,5,'),
          expect.stringContaining(',5,35000,5,'),
        ]),
      );
    });

    it('aggregates over datasets larger than 10000 orders', async () => {
      const { user: admin } = await createUser({
        email: 'admin@jdm.test',
        verified: true,
        role: 'admin',
      });
      const { user: buyer } = await createUser({ email: 'bulk-buyer@jdm.test', verified: true });

      await seedBulkStandaloneOrders({
        userId: buyer.id,
        count: 10005,
        amountCents: 100,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/finance/export',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const lines = res.body.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(',10005,1000500,10005,');
      expect(res.headers['x-ccc-k-anonymity-suppressed-groups']).toBe('0');
    });
  });
});
