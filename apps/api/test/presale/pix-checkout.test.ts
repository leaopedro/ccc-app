import { prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import { presaleCheckoutResponseSchema } from '@ccc/shared/presale';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { makeAppWithFakes, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';

const CHECKOUT_URL = '/presale/casa-in-box/checkout';

describe('POST /presale/casa-in-box/checkout (pix)', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let abacatepay: FakeAbacatePay;
  let variantId: string;
  let requestCounter = 0;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({
      enabled: true,
      shippingFeeCents: 1990,
      deliveryCepRanges: [],
    });

    const product = await createPresaleProduct({ allowPickup: true, allowShip: true });
    variantId = product.variants[0]!.id;

    const built = await makeAppWithFakes();
    app = built.app;
    stripe = built.stripe;
    abacatepay = built.abacatepay;
  });

  afterEach(async () => {
    await app.close();
  });

  const payload = (overrides: Record<string, unknown> = {}) => ({
    clientRequestId: `req-pix-${++requestCounter}-${Math.random().toString(36).slice(2, 10)}`,
    expectedTotalCents: 19800,
    fulfillmentMethod: 'pickup',
    paymentMethod: 'pix',
    items: [{ variantId, quantity: 2 }],
    guest: { name: 'Comprador Teste', email: 'comprador@exemplo.com' },
    acceptedTermsVersion: 'terms-2026-01-01',
    acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
    ...overrides,
  });

  const post = (overrides: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: CHECKOUT_URL, payload: payload(overrides) });

  type CheckoutBody = {
    orderId: string;
    paymentMethod?: string;
    brCode?: string;
    pixExpiresAt?: string;
    checkoutUrl?: string;
    amountCents?: number;
    shippingCents?: number;
    currency?: string;
    code?: string;
    message?: string;
  };

  const body = (res: Awaited<ReturnType<typeof post>>) => res.json() as CheckoutBody;

  const pixCalls = () => abacatepay.calls.filter((c) => c.method === 'createPixBilling');

  it('pix grava brCode, providerRef e expiresAt de 1h', async () => {
    const before = Date.now();
    const res = await post();
    const after = Date.now();

    expect(res.statusCode).toBe(201);
    const parsed = presaleCheckoutResponseSchema.parse(res.json());
    if (parsed.paymentMethod !== 'pix') throw new Error('esperava resposta pix');
    expect(parsed.brCode).toMatch(/\S/);
    expect(parsed.amountCents).toBe(19800);
    expect(parsed.shippingCents).toBe(0);
    expect(parsed.currency).toBe('BRL');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: parsed.orderId } });
    expect(order.method).toBe('pix');
    expect(order.provider).toBe('abacatepay');
    expect(order.status).toBe('pending');
    expect(order.brCode).toBe(parsed.brCode);
    expect(order.providerRef).toMatch(/\S/);
    expect(order.expiresAt).not.toBeNull();

    const expiresAtMs = order.expiresAt!.getTime();
    // "criação + 3600s", medido em janela relativa ao agora do teste — nunca
    // um carimbo fixo (ver Binding constraints do brief).
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 3600_000 - 5_000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 3600_000 + 5_000);
    expect(parsed.pixExpiresAt).toBe(order.expiresAt!.toISOString());

    expect(pixCalls()).toHaveLength(1);
    expect(pixCalls()[0]!.args[0]).toMatchObject({
      amountCents: 19800,
      expiresInSeconds: 3600,
      metadata: { orderId: order.id },
    });
    expect(pixCalls()[0]!.args[0]).not.toHaveProperty('customer');
  });

  it('clique duplo devolve o mesmo brCode e não cria segunda cobrança', async () => {
    const twice = payload();

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice }),
      app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice }),
    ]);

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(body(a).orderId).toBe(body(b).orderId);
    expect(body(a).brCode).toBe(body(b).brCode);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(1);
    expect(pixCalls()).toHaveLength(1);
  });

  it('provedor fora do ar devolve 502 e não deixa pedido sem código', async () => {
    abacatepay.nextBillingError = new Error('abacatepay fora do ar');

    const res = await post();

    expect(res.statusCode).toBe(502);
    expect(body(res).brCode).toBeUndefined();

    const order = await prisma.order.findFirstOrThrow({ where: { origin: 'casa_in_box' } });
    expect(order.status).toBe('failed');
    expect(order.brCode).toBeNull();
    expect(order.providerRef).toBeNull();
    expect(pixCalls()).toHaveLength(1);
  });

  it('cartão continua devolvendo checkoutUrl e expiresAt nulo', async () => {
    const res = await post({ paymentMethod: 'card' });

    expect(res.statusCode).toBe(201);
    const parsed = presaleCheckoutResponseSchema.parse(res.json());
    if (parsed.paymentMethod !== 'card') throw new Error('esperava resposta card');
    expect(parsed.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: parsed.orderId } });
    expect(order.method).toBe('card');
    expect(order.provider).toBe('stripe');
    expect(order.expiresAt).toBeNull();
    expect(order.brCode).toBeNull();
    expect(stripe.calls).toHaveLength(1);
    expect(pixCalls()).toHaveLength(0);
  });
});
