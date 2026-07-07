import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RC_AUTH_HEADER = 'Bearer test-rc-secret-123';

/** Build a minimal valid RC v2 event payload. */
const makeRCPayload = (overrides: {
  type?: string;
  id?: string;
  app_user_id?: string;
  product_id?: string;
  country_code?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  price_in_purchased_currency?: number;
  currency?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  period_type?: string;
}) => ({
  event: {
    type: overrides.type ?? 'INITIAL_PURCHASE',
    id: overrides.id ?? 'rc-event-001',
    app_user_id: overrides.app_user_id ?? 'garage-test-001',
    product_id: overrides.product_id ?? 'premium_gold_monthly',
    country_code: overrides.country_code ?? 'BR',
    event_timestamp_ms: Date.now(),
    transaction_id: overrides.transaction_id ?? 'txn-001',
    original_transaction_id: overrides.original_transaction_id ?? 'orig-txn-001',
    expiration_at_ms:
      overrides.expiration_at_ms === undefined
        ? Date.now() + 30 * 24 * 3600_000
        : overrides.expiration_at_ms,
    period_type: overrides.period_type ?? 'NORMAL',
    // RC sends prices in decimal currency units (29.90 = BRL 29.90). The
    // normalizer multiplies by 100 to convert to cents.
    price_in_purchased_currency: overrides.price_in_purchased_currency ?? 29.9,
    currency: overrides.currency ?? 'BRL',
    purchased_at_ms: overrides.purchased_at_ms ?? Date.now(),
  },
});

const postRC = (
  app: FastifyInstance,
  body: unknown,
  opts: { authorization?: string | null } = {},
) =>
  app.inject({
    method: 'POST',
    url: '/webhooks/revenuecat',
    headers: {
      'content-type': 'application/json',
      ...(opts.authorization === null
        ? {}
        : { authorization: opts.authorization ?? RC_AUTH_HEADER }),
    },
    payload: JSON.stringify(body),
  });

/**
 * Seed a real Garage row so the route's SELECT FOR UPDATE on garageId
 * (canon §F8.5) finds the row. Creates user + uses the auto-provisioned
 * garage; rewrites its id to the requested value via raw SQL (Prisma
 * does not allow @id updates via update()).
 */
const seedGarage = async (garageId: string): Promise<void> => {
  const { user } = await createUser({
    email: `rc-${garageId.replaceAll(/[^a-z0-9]/gi, '')}@jdm.test`,
    verified: true,
  });
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.$executeRaw`UPDATE "Garage" SET id = ${garageId} WHERE id = ${g.id}`;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/revenuecat', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = RC_AUTH_HEADER;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await postRC(app, makeRCPayload({}), { authorization: null });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when Authorization header is wrong', async () => {
      const res = await postRC(app, makeRCPayload({}), {
        authorization: 'Bearer wrong-secret',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 when Authorization header matches', async () => {
      const garageId = 'garage-auth-test';
      await seedGarage(garageId);
      const res = await postRC(app, makeRCPayload({ app_user_id: garageId }));
      expect(res.statusCode).not.toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Feature flag
  // -------------------------------------------------------------------------

  describe('feature flag', () => {
    it('returns 200 + skips processing when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
      await app.close();
      process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
      const disabledApp = await makeApp();
      try {
        const res = await postRC(disabledApp, makeRCPayload({}));
        expect(res.statusCode).toBe(200);
        const count = await prisma.subscriptionWebhookEvent.count();
        expect(count).toBe(0);
      } finally {
        await disabledApp.close();
      }
      // Re-arm flag so afterEach.close() doesn't fail (app already closed above).
      process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
      app = await makeApp();
    });
  });

  // -------------------------------------------------------------------------
  // Non-BR storefront (canon §F8.9)
  // -------------------------------------------------------------------------

  describe('non-BR storefront (canon §F8.9)', () => {
    it('returns 200 and writes no Membership/Invoice rows for non-BR country_code', async () => {
      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-non-br-001',
          country_code: 'US',
          app_user_id: 'garage-us-001',
        }),
      );

      expect(res.statusCode).toBe(200);
      const membership = await prisma.premiumMembership.findFirst();
      expect(membership).toBeNull();
      const invoice = await prisma.premiumMembershipInvoice.findFirst();
      expect(invoice).toBeNull();
    });

    it('acks non-BR without error even if country_code is empty string', async () => {
      const res = await postRC(
        app,
        makeRCPayload({ id: 'rc-empty-country-001', country_code: '' }),
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Replay / idempotency (canon §F8.15)
  // -------------------------------------------------------------------------

  describe('replay idempotency (canon §F8.15)', () => {
    it('returns 200 on replay without re-applying state changes', async () => {
      const garageId = 'garage-replay-001';
      await seedGarage(garageId);
      const body = makeRCPayload({
        id: 'rc-replay-evt-001',
        app_user_id: garageId,
        type: 'INITIAL_PURCHASE',
      });

      const first = await postRC(app, body);
      expect(first.statusCode).toBe(200);

      const eventRow = await prisma.subscriptionWebhookEvent.findFirst({
        where: { providerEventId: 'rc-replay-evt-001' },
      });
      expect(eventRow).toBeTruthy();

      const membershipCountBefore = await prisma.premiumMembership.count();
      const invoiceCountBefore = await prisma.premiumMembershipInvoice.count();

      const second = await postRC(app, body);
      expect(second.statusCode).toBe(200);

      expect(await prisma.premiumMembership.count()).toBe(membershipCountBefore);
      expect(await prisma.premiumMembershipInvoice.count()).toBe(invoiceCountBefore);
    });

    it('returns 503 when dedup hits an unprocessed event (retry path)', async () => {
      // Simulates apply tx crash after WebhookEvent insert: a row exists
      // with processedAt=null. A retry of the same event must NOT be
      // silently deduped — return 503 so RC retries and downstream apply
      // runs (idempotency protected by canon §F8.15 second layer).
      const providerEventId = 'rc-unprocessed-001';
      const garageId = 'garage-unprocessed-001';
      await seedGarage(garageId);

      const body = makeRCPayload({
        id: providerEventId,
        app_user_id: garageId,
        type: 'INITIAL_PURCHASE',
      });

      await prisma.subscriptionWebhookEvent.create({
        data: {
          provider: 'apple_revenuecat',
          providerEventId,
          type: 'INITIAL_PURCHASE',
          payload: body,
          processedAt: null,
        },
      });

      const res = await postRC(app, body);
      expect(res.statusCode).toBe(503);
      const parsed: { error?: string } = res.json();
      expect(parsed.error).toBe('Processing');
    });
  });

  // -------------------------------------------------------------------------
  // RC event type → DB state
  // -------------------------------------------------------------------------

  describe('INITIAL_PURCHASE → activated', () => {
    it('creates PremiumMembership (active) + PremiumMembershipInvoice + Garage snapshot', async () => {
      const garageId = 'garage-initial-001';
      await seedGarage(garageId);

      const purchasedAt = Date.now();
      const expiresAt = purchasedAt + 30 * 24 * 3600_000;

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-initial-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-initial-001',
          original_transaction_id: 'orig-txn-initial-001',
          purchased_at_ms: purchasedAt,
          expiration_at_ms: expiresAt,
          price_in_purchased_currency: 29.9,
          currency: 'BRL',
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirst({ where: { garageId } });
      expect(membership).toBeTruthy();
      expect(membership!.status).toBe('active');
      expect(membership!.provider).toBe('apple_revenuecat');
      expect(membership!.tier).toBe('gold');
      expect(membership!.devFeePercent).toBe(0);
      expect(membership!.devFeeAmountCents).toBe(0);
      expect(membership!.grossAmountCents).toBe(2990);
      expect(membership!.baseAmountCents).toBe(2990);
      expect(membership!.currency).toBe('BRL');

      const invoice = await prisma.premiumMembershipInvoice.findFirst({
        where: { membershipId: membership!.id },
      });
      expect(invoice).toBeTruthy();
      expect(invoice!.providerInvoiceRef).toBe('txn-initial-001');
      expect(invoice!.providerTransactionRef).toBe('orig-txn-initial-001');
      expect(invoice!.status).toBe('paid');

      const webhookEvent = await prisma.subscriptionWebhookEvent.findFirst({
        where: { providerEventId: 'rc-initial-001' },
      });
      expect(webhookEvent).toBeTruthy();
      expect(webhookEvent!.provider).toBe('apple_revenuecat');
      expect(webhookEvent!.type).toBe('INITIAL_PURCHASE');
      expect(webhookEvent!.payload).toBeTruthy();
      expect(webhookEvent!.processedAt).toBeTruthy();

      const garage = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garage!.premiumTier).toBe('gold');
      expect(garage!.premiumUntil).toBeTruthy();
    });
  });

  describe('RENEWAL → renewed', () => {
    it('updates existing PremiumMembership period + creates new invoice', async () => {
      const garageId = 'garage-renewal-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-renewal-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-renewal-001',
          original_transaction_id: 'orig-txn-renewal-001',
        }),
      );

      const before = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      const invoiceCountBefore = await prisma.premiumMembershipInvoice.count({
        where: { membershipId: before.id },
      });

      const newExpiry = Date.now() + 60 * 24 * 3600_000;
      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-renewal-001',
          type: 'RENEWAL',
          app_user_id: garageId,
          transaction_id: 'txn-renewal-002',
          original_transaction_id: 'orig-txn-renewal-001',
          expiration_at_ms: newExpiry,
        }),
      );

      expect(res.statusCode).toBe(200);

      const invoiceCountAfter = await prisma.premiumMembershipInvoice.count({
        where: { membershipId: before.id },
      });
      expect(invoiceCountAfter).toBe(invoiceCountBefore + 1);

      const after = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(after.status).toBe('active');
      expect(after.currentPeriodEnd.getTime()).toBeGreaterThan(before.currentPeriodEnd.getTime());
    });
  });

  describe('CANCELLATION → cancel_scheduled', () => {
    it('sets membership to cancel_scheduled; Garage snapshot unchanged', async () => {
      const garageId = 'garage-cancel-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-cancel-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-cancel-001',
          original_transaction_id: 'orig-txn-cancel-001',
        }),
      );

      const garageBefore = await prisma.garage.findUnique({ where: { id: garageId } });

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-cancel-001',
          type: 'CANCELLATION',
          app_user_id: garageId,
          transaction_id: 'txn-cancel-001',
          original_transaction_id: 'orig-txn-cancel-001',
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('cancel_scheduled');
      expect(membership.cancelAtPeriodEnd).toBe(true);

      const garageAfter = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garageAfter!.premiumTier).toBe(garageBefore!.premiumTier);
      expect(garageAfter!.premiumUntil?.getTime()).toBe(garageBefore!.premiumUntil?.getTime());
    });
  });

  describe('UNCANCELLATION → uncancelled', () => {
    it('sets membership back to active after cancel_scheduled', async () => {
      const garageId = 'garage-uncancel-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-uncancel-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-uncancel-001',
          original_transaction_id: 'orig-txn-uncancel-001',
        }),
      );

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-uncancel-cancel-001',
          type: 'CANCELLATION',
          app_user_id: garageId,
          transaction_id: 'txn-uncancel-001',
          original_transaction_id: 'orig-txn-uncancel-001',
        }),
      );

      const cancelled = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(cancelled.status).toBe('cancel_scheduled');

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-uncancel-001',
          type: 'UNCANCELLATION',
          app_user_id: garageId,
          transaction_id: 'txn-uncancel-001',
          original_transaction_id: 'orig-txn-uncancel-001',
        }),
      );

      expect(res.statusCode).toBe(200);

      const uncancelled = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(uncancelled.status).toBe('active');
      expect(uncancelled.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe('EXPIRATION → expired', () => {
    it('sets membership status to expired and clears Garage snapshot if no other active sub', async () => {
      const garageId = 'garage-expire-001';
      await seedGarage(garageId);

      const expiredAt = Date.now() - 1000;
      await postRC(
        app,
        makeRCPayload({
          id: 'rc-expire-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-expire-001',
          original_transaction_id: 'orig-txn-expire-001',
          expiration_at_ms: expiredAt,
        }),
      );

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-expire-001',
          type: 'EXPIRATION',
          app_user_id: garageId,
          transaction_id: 'txn-expire-001',
          original_transaction_id: 'orig-txn-expire-001',
          expiration_at_ms: expiredAt,
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('expired');

      const garage = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garage!.premiumTier).toBeNull();
      expect(garage!.premiumUntil).toBeNull();
    });
  });

  describe('BILLING_ISSUE → past_due', () => {
    it('sets membership to past_due without clearing Garage snapshot', async () => {
      const garageId = 'garage-pastdue-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-pastdue-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-pastdue-001',
          original_transaction_id: 'orig-txn-pastdue-001',
        }),
      );

      const garageBefore = await prisma.garage.findUnique({ where: { id: garageId } });

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-pastdue-001',
          type: 'BILLING_ISSUE',
          app_user_id: garageId,
          transaction_id: 'txn-pastdue-001',
          original_transaction_id: 'orig-txn-pastdue-001',
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('past_due');

      const garageAfter = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garageAfter!.premiumTier).toBe(garageBefore!.premiumTier);
    });
  });

  describe('PRODUCT_CHANGE → tier_changed', () => {
    it('updates membership pricing snapshot', async () => {
      const garageId = 'garage-tierchange-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-tierchange-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-tierchange-001',
          original_transaction_id: 'orig-txn-tierchange-001',
          price_in_purchased_currency: 29.9,
        }),
      );

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-tierchange-001',
          type: 'PRODUCT_CHANGE',
          app_user_id: garageId,
          transaction_id: 'txn-tierchange-002',
          original_transaction_id: 'orig-txn-tierchange-001',
          price_in_purchased_currency: 250.0,
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('active');
      expect(membership.grossAmountCents).toBe(25000);
    });
  });

  describe('TRANSFER / SUBSCRIPTION_PAUSED / unknown types → logged + acked', () => {
    it.each(['TRANSFER', 'SUBSCRIPTION_PAUSED', 'UNKNOWN_FUTURE_EVENT'])(
      'acks %s with 200 OK without writing Membership rows',
      async (eventType) => {
        const res = await postRC(
          app,
          makeRCPayload({
            id: `rc-noop-${eventType}-001`,
            type: eventType,
            app_user_id: 'garage-noop-001',
          }),
        );

        expect(res.statusCode).toBe(200);
        const membership = await prisma.premiumMembership.findFirst({
          where: { providerCustomerRef: 'garage-noop-001' },
        });
        expect(membership).toBeNull();
      },
    );
  });
});
