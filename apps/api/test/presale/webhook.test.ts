import { prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeStripe } from '../../src/services/stripe/fake.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';
import { createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

import { createPresaleProduct, createProductOrder, setPresaleSettings } from './fixtures.js';

const CHECKOUT_URL = '/presale/casa-in-box/checkout';
const WEBHOOK_URL = '/stripe/webhook';
const PI_ID = 'pi_presale_test_1';
const SESSION_ID = 'cs_presale_test_1';

describe('liquidação da pré-venda Casa In Box no webhook da Stripe', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let counter = 0;

  beforeEach(async () => {
    await resetDatabase();
    // PresaleSettings não é limpa por resetDatabase (test/helpers.ts é
    // compartilhado pela suíte inteira e fica intocado): zera aqui.
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({ enabled: true, shippingFeeCents: 1990 });

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

  const paymentIntentFailed = (orderId: string, eventId = `evt_pi_fail_${++counter}`) => ({
    id: eventId,
    type: 'payment_intent.payment_failed',
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

  const checkoutSessionExpired = (orderId: string, eventId = `evt_cs_exp_${++counter}`) => ({
    id: eventId,
    type: 'checkout.session.expired',
    data: { object: { id: SESSION_ID, metadata: { orderId } } },
  });

  /** Cria o pedido pelo endpoint público, igual à pessoa comprando. */
  const seedPresaleOrder = async (
    opts: { quantity?: number; quantityTotal?: number; priceCents?: number } = {},
  ) => {
    const quantity = opts.quantity ?? 2;
    const priceCents = opts.priceCents ?? 9900;
    const product = await createPresaleProduct(
      { allowPickup: true, allowShip: true },
      { variants: [{ priceCents, quantityTotal: opts.quantityTotal ?? 10 }] },
    );
    const variantId = product.variants[0]!.id;

    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        clientRequestId: `req-${++counter}-${Math.random().toString(36).slice(2, 10)}`,
        expectedTotalCents: priceCents * quantity,
        fulfillmentMethod: 'pickup',
        items: [{ variantId, quantity }],
        guest: { name: 'Comprador Teste', email: 'comprador@exemplo.com' },
        acceptedTermsVersion: 'terms-2026-01-01',
        acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`checkout de pré-venda falhou: ${res.statusCode} ${res.body}`);
    }
    return { orderId: (res.json() as { orderId: string }).orderId, variantId };
  };

  const statusOf = async (orderId: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  const soldOf = async (variantId: string) =>
    (await prisma.variant.findUniqueOrThrow({ where: { id: variantId } })).quantitySold;

  it('debita quantitySold só na liquidação', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 2 });

    // O checkout não reserva: até o pagamento confirmar, o saldo é intocado.
    expect(await soldOf(variantId)).toBe(0);

    const res = await postWebhook(checkoutSessionCompleted(orderId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('paid');
    expect(await soldOf(variantId)).toBe(2);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.providerRef).toBe(PI_ID);
    expect(order.paidAt).not.toBeNull();
  });

  it('permite passar do total, sem travar a liquidação', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 3, quantityTotal: 1 });

    const res = await postWebhook(checkoutSessionCompleted(orderId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('paid');
    expect(await soldOf(variantId)).toBe(3);
  });

  it('cartão recusado seguido de pagamento na mesma sessão liquida, não 500', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 2 });

    const failedRes = await postWebhook(paymentIntentFailed(orderId));
    expect(failedRes.statusCode).toBe(200);
    // Em Checkout hospedado a sessão segue aberta: o pedido NÃO morre aqui.
    expect(await statusOf(orderId)).toBe('pending');
    expect(await soldOf(variantId)).toBe(0);

    const res = await postWebhook(checkoutSessionCompleted(orderId));
    expect(res.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('paid');
    expect(await soldOf(variantId)).toBe(2);
  });

  it('pedido de pré-venda já failed ainda liquida quando a Stripe confirma', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 2 });
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'failed', failedAt: new Date() },
    });

    const res = await postWebhook(checkoutSessionCompleted(orderId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('paid');
    expect(await soldOf(variantId)).toBe(2);
    // Dinheiro entrou: nada de estorno.
    expect(stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(0);
  });

  it('os dois eventos de um mesmo pagamento debitam o estoque uma vez só', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 2 });

    const first = await postWebhook(paymentIntentSucceeded(orderId));
    const second = await postWebhook(checkoutSessionCompleted(orderId));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('paid');
    expect(await soldOf(variantId)).toBe(2);
  });

  it('reentrega do mesmo event.id é no-op', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 2 });
    const event = checkoutSessionCompleted(orderId, 'evt_cs_replay');

    const first = await postWebhook(event);
    const replay = await postWebhook(event);

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ deduped: true });
    expect(await soldOf(variantId)).toBe(2);
  });

  it('session.expired marca failed e não debita', async () => {
    const { orderId, variantId } = await seedPresaleOrder({ quantity: 2 });

    const res = await postWebhook(checkoutSessionExpired(orderId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(orderId)).toBe('failed');
    expect(await soldOf(variantId)).toBe(0);
  });

  it('pedido de ingresso com PI recusado continua virando failed', async () => {
    const { user } = await createUser({ verified: true });
    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Evento',
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
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 5000,
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        providerRef: PI_ID,
        status: 'pending',
      },
    });

    const res = await postWebhook(paymentIntentFailed(order.id));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(order.id)).toBe('failed');
    const after = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(after.quantitySold).toBe(0);
  });

  it('pedido de produto fora da pré-venda não debita quantitySold na liquidação', async () => {
    const order = await createProductOrder({ providerRef: PI_ID });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });

    const res = await postWebhook(paymentIntentSucceeded(order.id));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(order.id)).toBe('paid');
    // A loja reserva no carrinho; debitar de novo aqui seria contagem dobrada.
    expect(await soldOf(item.variantId!)).toBe(0);
  });
});
