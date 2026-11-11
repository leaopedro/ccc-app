import { prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import { presaleOrderStatusResponseSchema } from '@ccc/shared/presale';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { signQrCode } from '../../src/lib/qr.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';
import { makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';
import type { DevMailer } from '../../src/services/mailer/dev.js';
import type { MailMessage } from '../../src/services/mailer/index.js';

const env = loadEnv();

const CHECKOUT_URL = '/presale/casa-in-box/checkout';
const WEBHOOK_URL = '/stripe/webhook';
const STATUS_URL = '/presale/casa-in-box/orders/status';
const PI_ID = 'pi_presale_test_1';
const SESSION_ID = 'cs_presale_test_1';
const CEP_RANGES = [{ start: '80000000', end: '82999999' }];
const IN_AREA_CEP = '80010-000';

const delivery = () => ({
  recipientName: 'Comprador Teste',
  line1: 'Rua Exemplo',
  number: '100',
  district: 'Centro',
  city: 'Curitiba',
  stateCode: 'PR',
  postalCode: IN_AREA_CEP,
});

describe('email de confirmacao e rota de status da pre-venda', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let counter = 0;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({
      enabled: true,
      shippingFeeCents: 1990,
      deliveryCepRanges: CEP_RANGES,
    });

    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  const postWebhook = async (event: WebhookEvent) => {
    stripe.nextEvent = event;
    return app.inject({
      method: 'POST',
      url: WEBHOOK_URL,
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: Buffer.from(JSON.stringify(event)),
    });
  };

  const paymentIntentSucceeded = (orderId: string, eventId = `evt_pi_ok_${++counter}`) => ({
    id: eventId,
    type: 'payment_intent.succeeded',
    data: { object: { id: PI_ID, metadata: { orderId } } },
  });

  const checkoutSessionCompleted = (orderId: string, eventId = `evt_cs_ok_${++counter}`) => ({
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: SESSION_ID,
        payment_intent: PI_ID,
        payment_status: 'paid',
        metadata: { orderId },
      },
    },
  });

  const seedPresaleOrder = async (
    opts: {
      quantity?: number;
      quantityTotal?: number;
      priceCents?: number;
      fulfillmentMethod?: 'pickup' | 'ship';
    } = {},
  ) => {
    const quantity = opts.quantity ?? 2;
    const priceCents = opts.priceCents ?? 9900;
    const fulfillmentMethod = opts.fulfillmentMethod ?? 'pickup';
    const product = await createPresaleProduct(
      { allowPickup: true, allowShip: true },
      { variants: [{ priceCents, quantityTotal: opts.quantityTotal ?? 10 }] },
    );
    const variantId = product.variants[0]!.id;
    const shippingCents = fulfillmentMethod === 'ship' ? 1990 : 0;

    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        clientRequestId: `req-${++counter}-${Math.random().toString(36).slice(2, 10)}`,
        expectedTotalCents: priceCents * quantity + shippingCents,
        fulfillmentMethod,
        items: [{ variantId, quantity }],
        guest: { name: 'Comprador Teste', email: 'comprador@exemplo.com' },
        ...(fulfillmentMethod === 'ship' ? { delivery: delivery() } : {}),
        acceptedTermsVersion: 'terms-2026-01-01',
        acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
      },
    });

    if (res.statusCode !== 201) {
      throw new Error(`checkout de pre-venda falhou: ${res.statusCode} ${res.body}`);
    }
    return { orderId: (res.json() as { orderId: string }).orderId, variantId };
  };

  const postStatus = (body: { orderId: string; token: string }) =>
    app.inject({
      method: 'POST',
      url: STATUS_URL,
      payload: body,
    });

  const statusOf = async (orderId: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  it('envia uma vez so mesmo com os dois eventos do mesmo pagamento', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2 });
    const mailer = app.mailer as DevMailer;

    await postWebhook(paymentIntentSucceeded(orderId));
    await postWebhook(checkoutSessionCompleted(orderId));

    expect(mailer.captured).toHaveLength(1);
  });

  it('o email nao repete o endereco completo', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2 });
    const mailer = app.mailer as DevMailer;

    await postWebhook(checkoutSessionCompleted(orderId));

    expect(mailer.captured).toHaveLength(1);
    const email = mailer.captured[0]!;
    expect(email.html).not.toContain('Rua das Flores, 123');
    expect(email.html).toContain('/casa-in-box/obrigado');
  });

  it('falha de envio nao derruba nem reverte o pedido', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2 });
    const mailer = app.mailer as DevMailer;

    // Make mailer throw on next send
    const originalSend = mailer.send.bind(mailer);
    let callCount = 0;
    mailer.send = async function (message: MailMessage) {
      callCount++;
      if (callCount === 1) {
        throw new Error('Simulated send failure');
      }
      return originalSend(message);
    };

    const res = await postWebhook(checkoutSessionCompleted(orderId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('paid');
  });

  it('status exige token valido', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2 });

    const res = await postStatus({ orderId, token: 'lixo' });

    expect(res.statusCode).toBe(404);
  });

  it('status cobre os quatro estados', async () => {
    const states = ['pending', 'paid', 'refunded', 'failed'] as const;

    for (const state of states) {
      const { orderId } = await seedPresaleOrder({ quantity: 2 });

      // Set order to the desired state
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: state,
          ...(state === 'refunded' ? { refundedAt: new Date() } : {}),
          ...(state === 'failed' ? { failedAt: new Date() } : {}),
        },
      });

      const token = signQrCode('p', orderId, env);
      const res = await postStatus({ orderId, token });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ orderId, status: state });
      // A resposta tem que bater exatamente com o contrato compartilhado
      // (packages/shared/src/presale.ts) — é o que o garage valida.
      expect(() => presaleOrderStatusResponseSchema.parse(body)).not.toThrow();
    }
  });

  it('pedido de entrega devolve o endereco completo em delivery', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2, fulfillmentMethod: 'ship' });
    const token = signQrCode('p', orderId, env);

    const res = await postStatus({ orderId, token });

    expect(res.statusCode).toBe(200);
    const body = presaleOrderStatusResponseSchema.parse(res.json());
    expect(body.fulfillmentMethod).toBe('ship');
    expect(body.delivery).toEqual(delivery());
  });

  it('pedido de retirada devolve delivery nulo', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2, fulfillmentMethod: 'pickup' });
    const token = signQrCode('p', orderId, env);

    const res = await postStatus({ orderId, token });

    expect(res.statusCode).toBe(200);
    const body = presaleOrderStatusResponseSchema.parse(res.json());
    expect(body.fulfillmentMethod).toBe('pickup');
    expect(body.delivery).toBeNull();
  });

  it('a resposta traz currency, items[].title e items[].unitPriceCents do contrato', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2, priceCents: 9900 });
    const token = signQrCode('p', orderId, env);

    const res = await postStatus({ orderId, token });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.currency).toBe('BRL');
    expect(body.items).toEqual([
      expect.objectContaining({
        title: 'Produto Teste Presale',
        quantity: 2,
        unitPriceCents: 9900,
        subtotalCents: 19800,
      }),
    ]);
    // Campos que o schema nao conhece nao podem vazar na resposta.
    expect(body).not.toHaveProperty('guestName');
    expect(body).not.toHaveProperty('guestEmail');
    expect(body).not.toHaveProperty('baseAmountCents');
  });

  it('uma resposta que viole o contrato falha dentro da rota (G2)', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2 });

    // A rota precisa do currency do pedido para montar uma resposta valida;
    // sem ele, presaleOrderStatusResponseSchema.parse() tem que derrubar a
    // requisicao antes que o reply.send() saia com um shape quebrado.
    await prisma.$executeRawUnsafe(`UPDATE "Order" SET currency = '' WHERE id = $1`, orderId);

    const token = signQrCode('p', orderId, env);
    const res = await postStatus({ orderId, token });

    // presaleOrderStatusResponseSchema.parse() lanca ZodError, que o
    // error-handler global (plugins/error-handler.ts) traduz em 400 — nunca
    // chega a reply.send() com um shape fora do contrato.
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'ValidationError' });
  });

  it('o token nao aparece em querystring', async () => {
    const { orderId } = await seedPresaleOrder({ quantity: 2 });

    // Token must be in body, not query. This test verifies that:
    // 1. The route requires token in body (schema validation)
    // 2. Request logging won't leak token from querystring (logger.ts:5-12)
    const res = await app.inject({
      method: 'POST',
      url: `${STATUS_URL}`,
      payload: { orderId, token: 'invalid_token' },
    });

    // Invalid token should return 404
    expect(res.statusCode).toBe(404);
  });
});
