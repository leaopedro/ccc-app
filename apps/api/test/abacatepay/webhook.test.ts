import { prisma } from '@jdm/db';
import type { OrderStatus, PaymentProvider } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// JDMA-306: spy on Sentry to assert manual-refund flagging. ESM module
// namespaces aren't configurable, so a top-level mock is required.
vi.mock('@sentry/node', () => {
  const noop = () => {};
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: (
      cb: (scope: {
        setTag: (k: string, v: unknown) => void;
        setLevel: (l: string) => void;
        setExtras: (e: Record<string, unknown>) => void;
        setExtra: (k: string, v: unknown) => void;
        setContext: (k: string, v: unknown) => void;
      }) => void,
    ) => cb({ setTag: noop, setLevel: noop, setExtras: noop, setExtra: noop, setContext: noop }),
  };
});

const Sentry = (await import('@sentry/node')) as unknown as {
  captureMessage: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
};

import { buildApp } from '../../src/app.js';
import { type Env, loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay, type FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const baseEnv = loadEnv();
const TEST_WEBHOOK_SECRET = 'test-webhook-secret-abc123';
const env: Env = { ...baseEnv, ABACATEPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };

const webhookUrl = `/abacatepay/webhook?webhookSecret=${TEST_WEBHOOK_SECRET}`;

const makePayload = (
  overrides: Partial<{
    id: string;
    event: string;
    devMode: boolean;
    data: Record<string, unknown>;
  }> = {},
) =>
  JSON.stringify({
    id: overrides.id ?? `evt_${Date.now()}`,
    event: overrides.event ?? 'transparent.completed',
    devMode: overrides.devMode ?? false,
    data: overrides.data ?? { billing: { id: 'pix_123' }, amount: 5000 },
  });

const makeTransparentCompletedPayload = (
  billingId: string,
  eventId?: string,
  extra?: { metadata?: Record<string, string>; updatedAt?: string },
) =>
  JSON.stringify({
    id: eventId ?? `evt_${Date.now()}`,
    event: 'transparent.completed',
    devMode: false,
    data: {
      id: billingId,
      amount: 5000,
      status: 'PAID',
      createdAt: new Date().toISOString(),
      updatedAt: extra?.updatedAt ?? new Date().toISOString(),
      ...(extra?.metadata && { metadata: extra.metadata }),
    },
  });

type FailureEventType = 'transparent.lost' | 'transparent.refunded' | 'transparent.disputed';

const makeV2FailurePayload = (
  eventType: FailureEventType,
  billingId: string,
  eventId?: string,
  extra?: { metadata?: Record<string, string>; updatedAt?: string },
) =>
  JSON.stringify({
    id: eventId ?? `evt_${Date.now()}`,
    event: eventType,
    apiVersion: 2,
    devMode: false,
    data: {
      transparent: {
        id: billingId,
        amount: 5000,
        status: eventType === 'transparent.lost' ? 'EXPIRED' : 'REFUNDED',
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        createdAt: new Date().toISOString(),
        updatedAt: extra?.updatedAt ?? new Date().toISOString(),
        ...(extra?.metadata && { metadata: extra.metadata }),
      },
    },
  });

// Mirrors AbacatePay's actual v2 webhook payload for `transparent.completed`:
// data is nested under `data.transparent`, not flat.
// https://docs.abacatepay.com/pages/webhooks/events/transparent
const makeV2TransparentCompletedPayload = (
  billingId: string,
  eventId?: string,
  extra?: { metadata?: Record<string, string>; updatedAt?: string },
) =>
  JSON.stringify({
    id: eventId ?? `evt_${Date.now()}`,
    event: 'transparent.completed',
    apiVersion: 2,
    devMode: false,
    data: {
      transparent: {
        id: billingId,
        amount: 5000,
        paidAmount: 5000,
        status: 'PAID',
        frequency: 'ONE_TIME',
        devMode: true,
        methods: ['PIX'],
        createdAt: new Date().toISOString(),
        updatedAt: extra?.updatedAt ?? new Date().toISOString(),
        ...(extra?.metadata && { metadata: extra.metadata }),
      },
      customer: {
        id: 'cust_test',
        name: 'Maria Santos',
        email: 'maria@example.com',
        taxId: '12.***.***/0001-**',
      },
      payerInformation: {
        method: 'PIX',
        PIX: {
          name: 'Maria Santos',
          taxId: '12.***.***/0001-**',
          isSameAsCustomer: true,
        },
      },
    },
  });

const seedEventTierOrder = async (
  userId: string,
  opts?: { provider?: PaymentProvider; providerRef?: string; status?: OrderStatus },
) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento Teste',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 5,
      maxTicketsPerUser: 1,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 5,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      eventId: event.id,
      tierId: tier.id,
      amountCents: 5000,
      quantity: 1,
      method: 'pix',
      provider: opts?.provider ?? 'abacatepay',
      providerRef: opts?.providerRef ?? `pix_${Math.random().toString(36).slice(2, 10)}`,
      status: opts?.status ?? 'pending',
    },
  });
  return { event, tier, order };
};

const seedProductCartOrders = async (
  userId: string,
  billingId: string,
  opts?: { includeTicketOrder?: boolean },
) => {
  const productType = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'Algodão premium',
      productTypeId: productType.id,
      basePriceCents: 9000,
      currency: 'BRL',
      status: 'active',
      shippingFeeCents: 1500,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Preto — M',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 9000,
      quantityTotal: 10,
      quantitySold: 1,
      attributes: { size: 'M' },
      active: true,
    },
  });
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out', expiresAt: new Date(Date.now() + 600_000) },
  });
  const address = await prisma.shippingAddress.create({
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

  const orders = [
    await prisma.order.create({
      data: {
        userId,
        cartId: cart.id,
        kind: 'product',
        amountCents: 10_500,
        quantity: 1,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: billingId,
        shippingAddressId: address.id,
        shippingCents: 1500,
        fulfillmentMethod: 'ship',
        status: 'pending',
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
    }),
  ];

  if (opts?.includeTicketOrder) {
    const event = await prisma.event.create({
      data: {
        slug: `ev-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Evento Misto',
        description: 'desc',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 5,
        maxTicketsPerUser: 1,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 5000,
        quantityTotal: 5,
        quantitySold: 1,
        sortOrder: 0,
      },
    });
    orders.push(
      await prisma.order.create({
        data: {
          userId,
          eventId: event.id,
          tierId: tier.id,
          cartId: cart.id,
          amountCents: 5000,
          quantity: 1,
          method: 'pix',
          provider: 'abacatepay',
          status: 'pending',
          items: {
            create: {
              kind: 'ticket',
              tierId: tier.id,
              quantity: 1,
              unitPriceCents: 5000,
              subtotalCents: 5000,
            },
          },
        },
      }),
    );
  }

  return { cart, orders };
};

describe('POST /abacatepay/webhook', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;
  let push: DevPushSender;

  beforeEach(async () => {
    await resetDatabase();
    abacatepay = buildFakeAbacatePay();
    push = new DevPushSender();
    const stripe = buildFakeStripe();
    app = await buildApp(env, { stripe, abacatepay, push });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // --- URL-secret (C2) ---

  it('rejects missing webhookSecret query param with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/abacatepay/webhook',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(401);
    const body: { error: string } = res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects wrong webhookSecret query param with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/abacatepay/webhook?webhookSecret=wrong-secret',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(401);
  });

  // --- Signature (C1) ---

  it('rejects missing signature with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: { 'content-type': 'application/json' },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(401);
    const body: { error: string } = res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects invalid signature with 401', async () => {
    abacatepay.nextSignatureValid = false;
    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'bad-sig',
      },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(401);
  });

  // --- devMode (M-9) ---

  it('returns 400 for devMode events in production', async () => {
    const prodEnv: Env = {
      ...env,
      NODE_ENV: 'production' as const,
      ABACATEPAY_DEV_WEBHOOK_ENABLED: false,
      RESEND_API_KEY: 'fake-resend-key',
      SENTRY_DSN: undefined,
      WORKER_ENABLED: false,
    };
    const prodApp = await buildApp(prodEnv, {
      stripe: buildFakeStripe(),
      abacatepay: buildFakeAbacatePay(),
      push: new DevPushSender(),
    });

    Sentry.captureMessage.mockClear();
    const payload = makePayload({ id: 'evt_devmode_1', devMode: true });
    const res = await prodApp.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'BadRequest',
      message: 'devMode events rejected in production',
    });

    // Sentry must be alerted
    const devModeCalls = Sentry.captureMessage.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('devMode event received in production'),
    );
    expect(devModeCalls).toHaveLength(1);

    // Event should NOT be stored — it was rejected
    const record = await prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: 'abacatepay', eventId: 'evt_devmode_1' } },
    });
    expect(record).toBeNull();

    Sentry.captureMessage.mockClear();
    await prodApp.close();
  });

  it('processes devMode events in production when ABACATEPAY_DEV_WEBHOOK_ENABLED=true', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    const prodEnv: Env = {
      ...env,
      NODE_ENV: 'production',
      ABACATEPAY_DEV_WEBHOOK_ENABLED: true,
      RESEND_API_KEY: 'fake-resend-key',
      SENTRY_DSN: undefined,
      WORKER_ENABLED: false,
    };
    const prodApp = await buildApp(prodEnv, {
      stripe: buildFakeStripe(),
      abacatepay: buildFakeAbacatePay(),
      push: new DevPushSender(),
    });

    const payload = JSON.stringify({
      id: 'evt_devmode_prod_enabled',
      event: 'transparent.completed',
      devMode: true,
      data: { billing: { id: order.providerRef } },
    });

    const res = await prodApp.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('paid');
    await prodApp.close();
  });

  it('allows devMode events in non-production', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);
    const payload = JSON.stringify({
      id: 'evt_devmode_nonprod',
      event: 'transparent.completed',
      devMode: true,
      data: { billing: { id: order.providerRef } },
    });

    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });
    expect(res.statusCode).toBe(200);

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('paid');
  });

  // --- Basic acceptance ---

  it('accepts valid request and returns 200 for non-payment events', async () => {
    const payload = makePayload({ id: 'evt_valid_1', event: 'transparent.refunded' });
    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body: { ok: boolean } = res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 200 for unknown event types (L6 allowlist)', async () => {
    const payload = makePayload({ id: 'evt_unknown_1', event: 'some.unknown.event' });
    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    // Still stored for audit
    const record = await prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: 'abacatepay', eventId: 'evt_unknown_1' } },
    });
    expect(record).not.toBeNull();
  });

  it('deduplicates: second delivery of same event', async () => {
    const payload = makePayload({ id: 'evt_dedup_1', event: 'transparent.refunded' });
    const inject = () =>
      app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

    const first = await inject();
    expect(first.statusCode).toBe(200);

    const second = await inject();
    expect(second.statusCode).toBe(200);
    const secondBody: { ok: boolean } = second.json();
    expect(secondBody.ok).toBe(true);
  });

  it('stores webhook event in PaymentWebhookEvent table', async () => {
    const eventId = `evt_store_${Date.now()}`;
    const payload = makePayload({ id: eventId, event: 'transparent.refunded' });
    await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload,
    });

    const record = await prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: 'abacatepay', eventId } },
    });
    expect(record).not.toBeNull();
    expect(record!.provider).toBe('abacatepay');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload: Buffer.from('not json{{{'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects payload missing id field with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'valid-sig',
      },
      payload: JSON.stringify({ event: 'transparent.completed', data: {} }),
    });
    expect(res.statusCode).toBe(400);
  });

  // --- transparent.completed handler tests ---

  describe('transparent.completed', () => {
    it('marks order paid and issues ticket', async () => {
      const { user } = await createUser({ verified: true });
      const { order, event } = await seedEventTierOrder(user.id);
      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_paid_1');

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body: { ok: boolean } = res.json();
      expect(body.ok).toBe(true);

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('paid');
      expect(updatedOrder.paidAt).not.toBeNull();

      const ticket = await prisma.ticket.findFirst({
        where: { orderId: order.id, userId: user.id, eventId: event.id },
      });
      expect(ticket).not.toBeNull();
      expect(ticket!.source).toBe('purchase');
      expect(ticket!.status).toBe('valid');
    });

    it('sends push notification on first payment', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);

      await prisma.deviceToken.create({
        data: { userId: user.id, expoPushToken: 'ExponentPushToken[test]', platform: 'ios' },
      });

      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_push_1');
      await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(push.captured.length).toBe(1);
      expect(push.captured[0]!.title).toBe('Pagamento confirmado');
    });

    it('replay does not create duplicate ticket', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);
      const eventId = 'evt_replay_1';
      const payload = makeTransparentCompletedPayload(order.providerRef!, eventId);

      const inject = () =>
        app.inject({
          method: 'POST',
          url: webhookUrl,
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': 'valid-sig',
          },
          payload,
        });

      const first = await inject();
      expect(first.statusCode).toBe(200);

      const second = await inject();
      expect(second.statusCode).toBe(200);

      const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
      expect(tickets).toHaveLength(1);
    });

    it('returns 200 when ticket already exists (duplicate-ticket)', async () => {
      const { user } = await createUser({ verified: true });
      const { order, event } = await seedEventTierOrder(user.id);

      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: order.tierId!,
          source: 'comp',
          status: 'valid',
        },
      });

      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_conflict_1');
      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body: { ok: boolean } = res.json();
      expect(body.ok).toBe(true);
      // M2: No internal state leaked
      expect(body).not.toHaveProperty('manualRefund');
      expect(body).not.toHaveProperty('reason');
    });

    it('returns 200 when no matching order found (orphan event)', async () => {
      const payload = makeTransparentCompletedPayload('pix_no_such_order', 'evt_orphan_1');
      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body: { ok: boolean } = res.json();
      expect(body.ok).toBe(true);
    });

    it('handles expired order gracefully', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id, { status: 'expired' });

      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_expired_1');
      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body: { ok: boolean } = res.json();
      expect(body.ok).toBe(true);
      // M2: No internal state leaked
      expect(body).not.toHaveProperty('manualRefund');
    });

    // H2: Non-pending order fallthrough — failed status should not cause 500
    it('handles failed order gracefully without 500 (H2)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id, { status: 'failed' });

      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_failed_1');
      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body: { ok: boolean } = res.json();
      expect(body.ok).toBe(true);

      // Event was marked processed (no infinite retry)
      const record = await prisma.paymentWebhookEvent.findUnique({
        where: { provider_eventId: { provider: 'abacatepay', eventId: 'evt_failed_1' } },
      });
      expect(record).not.toBeNull();
    });

    it('succeeds idempotently for already-paid order without creating new ticket', async () => {
      const { user } = await createUser({ verified: true });
      const { order, event } = await seedEventTierOrder(user.id, { status: 'paid' });

      await prisma.ticket.create({
        data: {
          orderId: order.id,
          userId: user.id,
          eventId: event.id,
          tierId: order.tierId!,
          source: 'purchase',
          status: 'valid',
        },
      });

      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_alreadypaid_1');
      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body: { ok: boolean } = res.json();
      expect(body.ok).toBe(true);

      const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
      expect(tickets).toHaveLength(1);
    });

    // Primary lookup path: data.metadata.orderId
    it('uses data.metadata.orderId for primary order lookup', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id, {
        providerRef: 'pix_char_unrelated', // intentional mismatch — must use metadata
      });

      const payload = makeTransparentCompletedPayload(
        'pix_char_different_billing_id', // billingId in payload doesn't match providerRef
        'evt_metadata_lookup_1',
        { metadata: { orderId: order.id } },
      );

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('paid');
    });

    // M5: Stale replay rejection
    it('rejects events with payload timestamp older than 24h (M5)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);

      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const payload = makeTransparentCompletedPayload(order.providerRef!, 'evt_stale_1', {
        updatedAt: stale,
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      // Order should NOT be flipped to paid for stale events
      const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(unchangedOrder.status).toBe('pending');
    });

    it('handles legacy data.billing.id format (fallback extraction)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);

      const payload = JSON.stringify({
        id: 'evt_legacy_billing_1',
        event: 'transparent.completed',
        devMode: false,
        data: { billing: { id: order.providerRef }, amount: 5000 },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('paid');
    });

    it('handles v2 webhook shape with billing nested at data.transparent.id (JDMA-273)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);

      const payload = makeV2TransparentCompletedPayload(order.providerRef!, 'evt_v2_nested_1');

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('paid');
      expect(updatedOrder.paidAt).not.toBeNull();
    });

    it('uses data.transparent.metadata.orderId for v2 webhook lookup (JDMA-273)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id, {
        providerRef: 'pix_char_unrelated',
      });

      const payload = makeV2TransparentCompletedPayload(
        'pix_char_different_billing_id',
        'evt_v2_metadata_1',
        { metadata: { orderId: order.id } },
      );

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('paid');
    });

    it('rejects v2 webhook with stale data.transparent.updatedAt (JDMA-273)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);

      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const payload = makeV2TransparentCompletedPayload(order.providerRef!, 'evt_v2_stale_1', {
        updatedAt: stale,
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const unchangedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(unchangedOrder.status).toBe('pending');
    });

    it('handles legacy data.billingId format (fallback extraction)', async () => {
      const { user } = await createUser({ verified: true });
      const { order } = await seedEventTierOrder(user.id);

      const payload = JSON.stringify({
        id: 'evt_legacy_flat_1',
        event: 'transparent.completed',
        devMode: false,
        data: { billingId: order.providerRef, amount: 5000 },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('paid');
    });

    it('transparent.completed rejects when provider re-fetch shows non-PAID status', async () => {
      const { user } = await createUser();
      const providerRef = `pix_refetch_${Date.now()}`;
      const { order } = await seedEventTierOrder(user.id, { providerRef });

      abacatepay.nextStatus = { id: providerRef, status: 'EXPIRED', paidAt: null };

      const payload = makeV2TransparentCompletedPayload(providerRef, undefined, {
        metadata: { orderId: order.id },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: { 'content-type': 'application/json', 'x-webhook-signature': 'valid-sig' },
        payload,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, reason: 'upstream-not-paid' });

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('pending');

      const parsed = JSON.parse(payload) as { id: string };
      const deduped = await prisma.paymentWebhookEvent.findFirst({
        where: { eventId: parsed.id },
      });
      expect(deduped).toBeNull();
    });
  });

  describe('cart-level settlement (metadata.cartId)', () => {
    const seedEventAndTier = async (label: string) => {
      const event = await prisma.event.create({
        data: {
          slug: `cev-${Math.random().toString(36).slice(2, 8)}`,
          title: `Cart Event ${label}`,
          description: 'd',
          startsAt: new Date(Date.now() + 86400_000),
          endsAt: new Date(Date.now() + 90000_000),
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
          quantityTotal: 5,
          quantitySold: 1,
          sortOrder: 0,
        },
      });
      return { event, tier };
    };

    const seedCartWithPendingOrders = async (userId: string, billingId: string) => {
      const cart = await prisma.cart.create({
        data: { userId, status: 'checking_out', expiresAt: new Date(Date.now() + 600_000) },
      });
      const orders = [];
      for (let i = 0; i < 2; i++) {
        const { event, tier } = await seedEventAndTier(String(i));
        const order = await prisma.order.create({
          data: {
            userId,
            eventId: event.id,
            tierId: tier.id,
            cartId: cart.id,
            amountCents: 5000,
            quantity: 1,
            method: 'pix',
            provider: 'abacatepay',
            providerRef: i === 0 ? billingId : null,
            status: 'pending',
          },
        });
        orders.push(order);
      }
      return { cart, orders };
    };

    it('settles all pending cart orders when transparent.completed has metadata.cartId', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = 'pix_cart_billing_1';
      const { cart, orders } = await seedCartWithPendingOrders(user.id, billingId);

      const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_settle_1', {
        metadata: { cartId: cart.id, userId: user.id },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findMany({
        where: { id: { in: orders.map((o) => o.id) } },
      });
      for (const o of updated) {
        expect(o.status).toBe('paid');
      }
      const cartAfter = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
      expect(cartAfter.status).toBe('converted');

      const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
      expect(tickets).toHaveLength(orders.length);
    });

    it('dedupes cart settlement on replay', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = 'pix_cart_billing_dedupe';
      const { cart } = await seedCartWithPendingOrders(user.id, billingId);

      const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_dedup_1', {
        metadata: { cartId: cart.id },
      });

      const first = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });
      expect(second.statusCode).toBe(200);
      const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
      expect(tickets).toHaveLength(2);
    });

    it('settles product-only cart orders without issuing tickets', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = 'pix_cart_products_only';
      const { cart, orders } = await seedProductCartOrders(user.id, billingId);

      const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_products_only', {
        metadata: { cartId: cart.id, userId: user.id },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);

      const updated = await prisma.order.findMany({
        where: { id: { in: orders.map((o) => o.id) } },
        select: { status: true, shippingCents: true },
      });
      expect(updated).toEqual([expect.objectContaining({ status: 'paid', shippingCents: 1500 })]);

      const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
      expect(tickets).toHaveLength(0);
      expect(push.captured).toHaveLength(0);
    });

    const seedSingleMixedOrderCart = async (userId: string, billingId: string) => {
      const productType = await prisma.productType.create({
        data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
      });
      const product = await prisma.product.create({
        data: {
          slug: `p-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Camiseta JDM',
          description: 'Algodão premium',
          productTypeId: productType.id,
          basePriceCents: 9000,
          currency: 'BRL',
          status: 'active',
          shippingFeeCents: 1500,
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'Preto — M',
          sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          priceCents: 9000,
          quantityTotal: 10,
          quantitySold: 1,
          attributes: { size: 'M' },
          active: true,
        },
      });
      const event = await prisma.event.create({
        data: {
          slug: `ev-${Math.random().toString(36).slice(2, 8)}`,
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
          capacity: 5,
          maxTicketsPerUser: 5,
          publishedAt: new Date(),
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 5,
          quantitySold: 1,
          sortOrder: 0,
        },
      });
      const cart = await prisma.cart.create({
        data: { userId, status: 'checking_out', expiresAt: new Date(Date.now() + 600_000) },
      });
      const address = await prisma.shippingAddress.create({
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
      const order = await prisma.order.create({
        data: {
          userId,
          cartId: cart.id,
          kind: 'mixed',
          amountCents: 15_500,
          quantity: 2,
          method: 'pix',
          provider: 'abacatepay',
          providerRef: billingId,
          shippingAddressId: address.id,
          shippingCents: 1500,
          fulfillmentMethod: 'ship',
          status: 'pending',
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
      return { cart, order, event };
    };

    it('settles single mixed Order cart and fires ticket.confirmed push', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = 'pix_cart_mixed_single_push';
      const { cart, order } = await seedSingleMixedOrderCart(user.id, billingId);
      await prisma.deviceToken.create({
        data: {
          userId: user.id,
          expoPushToken: 'ExponentPushToken[mixedSingle]',
          platform: 'ios',
        },
      });

      const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_mixed_single_push', {
        metadata: { cartId: cart.id, userId: user.id },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('paid');
      expect(updated.kind).toBe('mixed');

      const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
      expect(tickets).toHaveLength(1);

      expect(push.captured).toHaveLength(1);
      const notif = await prisma.notification.findFirstOrThrow({
        where: { userId: user.id, kind: 'ticket.confirmed' },
      });
      expect(notif.dedupeKey).toBe(`cart_${cart.id}`);
    });

    it('settles mixed cart orders and only issues tickets for event lines', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = 'pix_cart_mixed_1';
      const { cart, orders } = await seedProductCartOrders(user.id, billingId, {
        includeTicketOrder: true,
      });
      await prisma.deviceToken.create({
        data: { userId: user.id, expoPushToken: 'ExponentPushToken[test]', platform: 'ios' },
      });

      const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_mixed_1', {
        metadata: { cartId: cart.id, userId: user.id },
      });

      const res = await app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': 'valid-sig',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);

      const updated = await prisma.order.findMany({
        where: { id: { in: orders.map((o) => o.id) } },
        select: { kind: true, status: true },
      });
      expect(updated.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
        { kind: 'product', status: 'paid' },
        { kind: 'ticket', status: 'paid' },
      ]);

      const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
      expect(tickets).toHaveLength(1);
      expect(push.captured).toHaveLength(1);
    });

    // JDMA-306: cart checkout creates AbacatePay billing then writes order rows.
    // If the local write/response path fails after createPixBilling() succeeds,
    // rollbackCartCheckout() deletes pending orders while the billing can still
    // settle. The webhook would previously hit `ignored: true` with no signal.
    describe('orphan billing reconciliation (JDMA-306)', () => {
      it('flags manual refund when billing settles and no cart orders exist', async () => {
        const { user } = await createUser({ verified: true });
        Sentry.captureMessage.mockClear();

        const orphanCartId = `cart_${Math.random().toString(36).slice(2, 10)}`;
        const orphanOrderIds = ['ord_a', 'ord_b'];
        const billingId = 'pix_cart_orphan_1';

        const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_orphan_1', {
          metadata: {
            cartId: orphanCartId,
            userId: user.id,
            orderIds: JSON.stringify(orphanOrderIds),
          },
        });

        const res = await app.inject({
          method: 'POST',
          url: webhookUrl,
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': 'valid-sig',
          },
          payload,
        });

        expect(res.statusCode).toBe(200);
        const body: { ok: boolean } = res.json();
        expect(body.ok).toBe(true);
        // M2: don't leak internal state in response
        expect(body).not.toHaveProperty('manualRefund');
        expect(body).not.toHaveProperty('reason');

        const orphanCalls = Sentry.captureMessage.mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('manual refund needed'),
        );
        expect(orphanCalls).toHaveLength(1);
        expect(orphanCalls[0]![0]).toContain('cart-orphan-billing');
        expect(orphanCalls[0]![1]).toBe('error');

        // Event is recorded so replays dedup
        const stored = await prisma.paymentWebhookEvent.findUnique({
          where: { provider_eventId: { provider: 'abacatepay', eventId: 'evt_cart_orphan_1' } },
        });
        expect(stored).not.toBeNull();

        Sentry.captureMessage.mockClear();
      });

      it('does not re-flag manual refund on webhook replay', async () => {
        const { user } = await createUser({ verified: true });
        Sentry.captureMessage.mockClear();

        const orphanCartId = `cart_${Math.random().toString(36).slice(2, 10)}`;
        const billingId = 'pix_cart_orphan_replay';

        const payload = makeV2TransparentCompletedPayload(billingId, 'evt_cart_orphan_replay', {
          metadata: {
            cartId: orphanCartId,
            userId: user.id,
            orderIds: JSON.stringify(['ord_a']),
          },
        });

        const inject = () =>
          app.inject({
            method: 'POST',
            url: webhookUrl,
            headers: {
              'content-type': 'application/json',
              'x-webhook-signature': 'valid-sig',
            },
            payload,
          });

        const first = await inject();
        expect(first.statusCode).toBe(200);

        const second = await inject();
        expect(second.statusCode).toBe(200);

        const orphanCalls = Sentry.captureMessage.mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('manual refund needed'),
        );
        expect(orphanCalls).toHaveLength(1);

        Sentry.captureMessage.mockClear();
      });

      // JDMA-306 partial-mismatch: metadata.orderIds lists every order the
      // checkout intended to bill. If some were rolled back between billing
      // creation and webhook delivery, the surviving rows settle but the
      // missing billed rows still need finance reconciliation.
      it('flags manual refund for missing rows when metadata.orderIds exceeds pending orders', async () => {
        const { user } = await createUser({ verified: true });
        const billingId = 'pix_cart_partial_mismatch_1';
        const { cart, orders } = await seedCartWithPendingOrders(user.id, billingId);
        Sentry.captureMessage.mockClear();

        const survivingId = orders[0]!.id;
        const missingId = 'ord_missing_partial';

        const payload = makeV2TransparentCompletedPayload(
          billingId,
          'evt_cart_partial_mismatch_1',
          {
            metadata: {
              cartId: cart.id,
              userId: user.id,
              orderIds: JSON.stringify([survivingId, orders[1]!.id, missingId]),
            },
          },
        );

        const res = await app.inject({
          method: 'POST',
          url: webhookUrl,
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': 'valid-sig',
          },
          payload,
        });

        expect(res.statusCode).toBe(200);

        const settled = await prisma.order.findMany({
          where: { id: { in: orders.map((o) => o.id) } },
        });
        for (const o of settled) {
          expect(o.status).toBe('paid');
        }

        const cartAfter = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
        expect(cartAfter.status).toBe('converted');

        const partialCalls = Sentry.captureMessage.mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('cart-partial-orphan-billing'),
        );
        expect(partialCalls).toHaveLength(1);
        expect(partialCalls[0]![1]).toBe('error');

        Sentry.captureMessage.mockClear();
      });

      it('does not re-flag partial-mismatch refund on webhook replay', async () => {
        const { user } = await createUser({ verified: true });
        const billingId = 'pix_cart_partial_mismatch_replay';
        const { cart, orders } = await seedCartWithPendingOrders(user.id, billingId);
        Sentry.captureMessage.mockClear();

        const payload = makeV2TransparentCompletedPayload(
          billingId,
          'evt_cart_partial_mismatch_replay',
          {
            metadata: {
              cartId: cart.id,
              userId: user.id,
              orderIds: JSON.stringify([orders[0]!.id, orders[1]!.id, 'ord_missing_replay']),
            },
          },
        );

        const inject = () =>
          app.inject({
            method: 'POST',
            url: webhookUrl,
            headers: {
              'content-type': 'application/json',
              'x-webhook-signature': 'valid-sig',
            },
            payload,
          });

        const first = await inject();
        expect(first.statusCode).toBe(200);

        const second = await inject();
        expect(second.statusCode).toBe(200);

        const partialCalls = Sentry.captureMessage.mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('cart-partial-orphan-billing'),
        );
        expect(partialCalls).toHaveLength(1);

        Sentry.captureMessage.mockClear();
      });
    });
  });

  // JDMA-407: failure events must release inventory immediately rather than
  // wait for the TTL sweep. `lost` mirrors Stripe payment_failed (pending Pix
  // never paid); `refunded`/`disputed` map to OrderStatus.refunded.
  describe('failure events (lost/refunded/disputed)', () => {
    const seedTicketOrderWithExtras = async (userId: string, billingId: string) => {
      const event = await prisma.event.create({
        data: {
          slug: `e-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Evento Falha',
          description: 'desc',
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 90_000_000),
          venueName: 'v',
          venueAddress: 'a',
          city: 'São Paulo',
          stateCode: 'SP',
          type: 'meeting',
          status: 'published',
          capacity: 5,
          maxTicketsPerUser: 1,
          publishedAt: new Date(),
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 5,
          quantitySold: 1,
          sortOrder: 0,
        },
      });
      const extra = await prisma.ticketExtra.create({
        data: { eventId: event.id, name: 'Camiseta', priceCents: 2000, quantitySold: 1 },
      });
      const order = await prisma.order.create({
        data: {
          userId,
          eventId: event.id,
          tierId: tier.id,
          amountCents: 7000,
          quantity: 1,
          method: 'pix',
          provider: 'abacatepay',
          providerRef: billingId,
          status: 'pending',
        },
      });
      await prisma.orderExtra.create({
        data: { orderId: order.id, extraId: extra.id, quantity: 1 },
      });
      return { event, tier, extra, order };
    };

    const seedMixedCart = async (userId: string, billingId: string) => {
      const productType = await prisma.productType.create({
        data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
      });
      const product = await prisma.product.create({
        data: {
          slug: `p-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Camiseta JDM',
          description: 'd',
          productTypeId: productType.id,
          basePriceCents: 9000,
          currency: 'BRL',
          status: 'active',
          shippingFeeCents: 1500,
        },
      });
      const variant = await prisma.variant.create({
        data: {
          productId: product.id,
          name: 'Preto — M',
          sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          priceCents: 9000,
          quantityTotal: 10,
          quantitySold: 1,
          attributes: { size: 'M' },
          active: true,
        },
      });
      const event = await prisma.event.create({
        data: {
          slug: `ev-${Math.random().toString(36).slice(2, 8)}`,
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
          capacity: 5,
          maxTicketsPerUser: 5,
          publishedAt: new Date(),
        },
      });
      const tier = await prisma.ticketTier.create({
        data: {
          eventId: event.id,
          name: 'Geral',
          priceCents: 5000,
          quantityTotal: 5,
          quantitySold: 1,
          sortOrder: 0,
        },
      });
      const cart = await prisma.cart.create({
        data: { userId, status: 'checking_out', expiresAt: new Date(Date.now() + 600_000) },
      });
      const address = await prisma.shippingAddress.create({
        data: {
          userId,
          recipientName: 'Maria',
          line1: 'R',
          number: '1',
          district: 'C',
          city: 'C',
          stateCode: 'PR',
          postalCode: '80000-000',
          phone: '41999999999',
          isDefault: true,
        },
      });
      const order = await prisma.order.create({
        data: {
          userId,
          cartId: cart.id,
          kind: 'mixed',
          amountCents: 15_500,
          quantity: 2,
          method: 'pix',
          provider: 'abacatepay',
          providerRef: billingId,
          shippingAddressId: address.id,
          shippingCents: 1500,
          fulfillmentMethod: 'ship',
          status: 'pending',
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
      return { cart, order, tier, variant, event };
    };

    const post = (payload: string) =>
      app.inject({
        method: 'POST',
        url: webhookUrl,
        headers: { 'content-type': 'application/json', 'x-webhook-signature': 'valid-sig' },
        payload,
      });

    it('transparent.lost releases ticket-only order: tier+extras stock, status=failed', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_lost_ticket_${Date.now()}`;
      const { tier, extra, order } = await seedTicketOrderWithExtras(user.id, billingId);

      const res = await post(
        makeV2FailurePayload('transparent.lost', billingId, 'evt_lost_ticket_1', {
          metadata: { orderId: order.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('failed');
      expect(updated.failedAt).not.toBeNull();
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
      const extraAfter = await prisma.ticketExtra.findUniqueOrThrow({ where: { id: extra.id } });
      expect(extraAfter.quantitySold).toBe(0);
    });

    it('transparent.refunded releases ticket-only pending order: status=refunded', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_refunded_ticket_${Date.now()}`;
      const { tier, order } = await seedTicketOrderWithExtras(user.id, billingId);

      const res = await post(
        makeV2FailurePayload('transparent.refunded', billingId, 'evt_refunded_ticket_1', {
          metadata: { orderId: order.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('refunded');
      expect(updated.failedAt).toBeNull();
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
    });

    it('transparent.disputed releases ticket-only pending order: status=refunded', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_disputed_ticket_${Date.now()}`;
      const { tier, order } = await seedTicketOrderWithExtras(user.id, billingId);

      const res = await post(
        makeV2FailurePayload('transparent.disputed', billingId, 'evt_disputed_ticket_1', {
          metadata: { orderId: order.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('refunded');
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
    });

    it('transparent.lost on product-only cart releases variant stock and reopens cart', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_lost_product_${Date.now()}`;
      const { cart, orders } = await seedProductCartOrders(user.id, billingId);
      const variantId = (
        await prisma.orderItem.findFirstOrThrow({
          where: { orderId: orders[0]!.id, kind: 'product' },
          select: { variantId: true },
        })
      ).variantId!;

      const res = await post(
        makeV2FailurePayload('transparent.lost', billingId, 'evt_lost_product_1', {
          metadata: { cartId: cart.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orders[0]!.id } });
      expect(updatedOrder.status).toBe('failed');
      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
      expect(variantAfter.quantitySold).toBe(0);
      const cartAfter = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
      expect(cartAfter.status).toBe('open');
    });

    it('transparent.lost on mixed cart releases tier+variant+extras and reopens cart', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_lost_mixed_${Date.now()}`;
      const { cart, order, tier, variant } = await seedMixedCart(user.id, billingId);

      const res = await post(
        makeV2FailurePayload('transparent.lost', billingId, 'evt_lost_mixed_1', {
          metadata: { cartId: cart.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('failed');
      expect(updated.failedAt).not.toBeNull();
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(0);
      const cartAfter = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
      expect(cartAfter.status).toBe('open');
    });

    it('transparent.refunded on mixed cart releases stock; cart status unchanged', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_refunded_mixed_${Date.now()}`;
      const { cart, order, tier, variant } = await seedMixedCart(user.id, billingId);

      const res = await post(
        makeV2FailurePayload('transparent.refunded', billingId, 'evt_refunded_mixed_1', {
          metadata: { cartId: cart.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('refunded');
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
      const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(variantAfter.quantitySold).toBe(0);
      const cartAfter = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
      expect(cartAfter.status).toBe('checking_out');
    });

    it('replay of transparent.lost does not double-release stock', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_lost_replay_${Date.now()}`;
      const { tier, order } = await seedTicketOrderWithExtras(user.id, billingId);

      const payload = makeV2FailurePayload('transparent.lost', billingId, 'evt_lost_replay_1', {
        metadata: { orderId: order.id },
      });

      const first = await post(payload);
      expect(first.statusCode).toBe(200);
      const second = await post(payload);
      expect(second.statusCode).toBe(200);

      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('failed');
    });

    it('transparent.refunded on already-paid order marks status=refunded without stock change', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_refunded_paid_${Date.now()}`;
      const { tier, order } = await seedTicketOrderWithExtras(user.id, billingId);
      await prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } });

      const res = await post(
        makeV2FailurePayload('transparent.refunded', billingId, 'evt_refunded_paid_1', {
          metadata: { orderId: order.id },
        }),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('refunded');
      expect(updated.refundedAt).toBeInstanceOf(Date);
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(1);
    });

    it('transparent.refunded revokes tickets for paid orders', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_refunded_revoke_${Date.now()}`;
      const { event, tier, order } = await seedEventTierOrder(user.id, {
        status: 'paid',
        providerRef: billingId,
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { paidAt: new Date() },
      });

      const ticket = await prisma.ticket.create({
        data: {
          orderId: order.id,
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          source: 'purchase',
          status: 'valid',
        },
      });

      const res = await post(
        makeV2FailurePayload(
          'transparent.refunded',
          billingId,
          `evt_refunded_revoke_${Date.now()}`,
          {
            metadata: { orderId: order.id },
          },
        ),
      );

      expect(res.statusCode).toBe(200);

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('refunded');

      const updatedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(updatedTicket.status).toBe('revoked');
    });

    it('transparent.lost falls back to providerRef lookup when metadata missing', async () => {
      const { user } = await createUser({ verified: true });
      const billingId = `pix_lost_fallback_${Date.now()}`;
      const { tier, order } = await seedTicketOrderWithExtras(user.id, billingId);

      const res = await post(
        makeV2FailurePayload('transparent.lost', billingId, 'evt_lost_fallback_1'),
      );

      expect(res.statusCode).toBe(200);
      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('failed');
      const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(tierAfter.quantitySold).toBe(0);
    });
  });
});
