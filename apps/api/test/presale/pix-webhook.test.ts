// Liquidação da pré-venda Casa In Box pelo webhook do AbacatePay (Pix).
// Espelha test/presale/webhook.test.ts (Stripe/cartão), mas para o caminho
// Pix: sendPresaleConfirmationEmail precisa ser chamado aqui também — hoje só
// routes/stripe-webhook.ts chama. Escopo por origin === 'casa_in_box' ANTES
// de tocar o pedido (achado I2): envio não escopado carimbava pedido comum
// da loja com um UPDATE que não deveria acontecer.
import { prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// C2: espiona o Sentry para provar que um pagamento tardio para um pedido de
// pré-venda com o prazo do código vencido NÃO dispara o alerta de
// manual-refund (flagManualRefund usa Sentry.captureMessage, não grava em
// tabela nenhuma — sem o spy não haveria como diferenciar "não disparou" de
// "disparou e não checamos"). Namespace ESM não é configurável, por isso o
// mock vai no topo do módulo (mesmo padrão de test/abacatepay/webhook.test.ts).
vi.mock('@sentry/node', () => {
  const noop = () => undefined;
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    setUser: vi.fn(),
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
};

import { buildApp } from '../../src/app.js';
import { type Env, loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { DevMailer } from '../../src/services/mailer/dev.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { runOrderExpiryTick } from '../../src/workers/order-expiry.js';
import { createUser, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';

const baseEnv = loadEnv();
const TEST_WEBHOOK_SECRET = 'test-webhook-secret-presale-pix';
const env: Env = { ...baseEnv, ABACATEPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };

const CHECKOUT_URL = '/presale/casa-in-box/checkout';
const WEBHOOK_URL = `/abacatepay/webhook?webhookSecret=${TEST_WEBHOOK_SECRET}`;

// Mesma forma v2 usada em test/abacatepay/webhook.test.ts: data.transparent,
// não data flat.
const makeTransparentCompletedPayload = (
  billingId: string,
  eventId: string,
  metadata: Record<string, string> = {},
) =>
  JSON.stringify({
    id: eventId,
    event: 'transparent.completed',
    apiVersion: 2,
    devMode: false,
    data: {
      transparent: {
        id: billingId,
        amount: 19800,
        paidAmount: 19800,
        status: 'PAID',
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(Object.keys(metadata).length > 0 && { metadata }),
      },
    },
  });

// Mesma forma v2, para o evento de falha. O conteúdo de `status` dentro de
// `transparent` não importa aqui: a branch de `transparent.lost` no webhook
// não re-consulta o provedor, ao contrário de `transparent.completed`.
const makeTransparentLostPayload = (
  billingId: string,
  eventId: string,
  metadata: Record<string, string> = {},
) =>
  JSON.stringify({
    id: eventId,
    event: 'transparent.lost',
    apiVersion: 2,
    devMode: false,
    data: {
      transparent: {
        id: billingId,
        amount: 19800,
        status: 'EXPIRED',
        frequency: 'ONE_TIME',
        methods: ['PIX'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(Object.keys(metadata).length > 0 && { metadata }),
      },
    },
  });

describe('liquidação da pré-venda Casa In Box no webhook do AbacatePay (Pix)', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let counter = 0;

  beforeEach(async () => {
    await resetDatabase();
    // PresaleSettings não é limpa por resetDatabase (test/helpers.ts é
    // compartilhado pela suíte inteira e fica intocado): zera aqui.
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({ enabled: true, shippingFeeCents: 1990 });

    stripe = buildFakeStripe();
    app = await buildApp(env, { stripe, abacatepay: buildFakeAbacatePay() });
  });

  afterEach(async () => {
    await app.close();
  });

  /** Cria o pedido pelo endpoint público de pré-venda, pagamento Pix. */
  const seedPresalePixOrder = async (opts: { quantity?: number; priceCents?: number } = {}) => {
    const quantity = opts.quantity ?? 2;
    const priceCents = opts.priceCents ?? 9900;
    const product = await createPresaleProduct(
      { allowPickup: true, allowShip: true },
      { variants: [{ priceCents, quantityTotal: 10 }] },
    );
    const variantId = product.variants[0]!.id;

    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        clientRequestId: `req-pix-${++counter}-${Math.random().toString(36).slice(2, 10)}`,
        expectedTotalCents: priceCents * quantity,
        fulfillmentMethod: 'pickup',
        paymentMethod: 'pix',
        items: [{ variantId, quantity }],
        guest: { name: 'Comprador Teste', email: 'comprador@exemplo.com' },
        acceptedTermsVersion: 'terms-2026-01-01',
        acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`checkout pix de pré-venda falhou: ${res.statusCode} ${res.body}`);
    }
    const body = res.json() as { orderId: string };
    return prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
  };

  const postWebhook = (payload: string) =>
    app.inject({
      method: 'POST',
      url: WEBHOOK_URL,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': 'valid-sig' },
      payload,
    });

  it('liquida pedido de pré-venda e envia email de confirmação', async () => {
    const order = await seedPresalePixOrder();
    const mailer = app.mailer as DevMailer;
    // O checkout já disparou o email do código Pix; zera para isolar o email
    // de confirmação que o webhook deve enviar.
    mailer.clear();

    const res = await postWebhook(
      makeTransparentCompletedPayload(order.providerRef!, 'evt_pix_presale_settle_1', {
        orderId: order.id,
      }),
    );

    expect(res.statusCode).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');
    expect(updated.confirmationEmailSentAt).not.toBeNull();

    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.to).toBe('comprador@exemplo.com');
  });

  it('evento repetido liquida uma vez e envia email uma vez', async () => {
    const order = await seedPresalePixOrder();
    const mailer = app.mailer as DevMailer;
    mailer.clear();
    const payload = makeTransparentCompletedPayload(
      order.providerRef!,
      'evt_pix_presale_replay_1',
      { orderId: order.id },
    );

    const first = await postWebhook(payload);
    expect(first.statusCode).toBe(200);

    const second = await postWebhook(payload);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true });

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');
    expect(mailer.captured).toHaveLength(1);
  });

  it('pedido comum da loja não ganha comportamento novo', async () => {
    const { user } = await createUser({
      email: `loja-pix-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    });
    const billingId = `pix_char_loja_${Math.random().toString(36).slice(2, 10)}`;
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 9000,
        quantity: 1,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: billingId,
        status: 'pending',
      },
    });
    const mailer = app.mailer as DevMailer;

    const res = await postWebhook(
      makeTransparentCompletedPayload(billingId, 'evt_pix_store_order_1'),
    );

    expect(res.statusCode).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');
    // I2: nenhum comportamento novo para pedido comum da loja.
    expect(updated.confirmationEmailSentAt).toBeNull();
    expect(mailer.captured).toHaveLength(0);
  });

  // C2 — a promessa central da feature: quem paga o Pix DEPOIS do prazo de
  // uma hora ainda recebe a caixa. O tick REAL de order-expiry.ts roda
  // primeiro aqui (não um UPDATE direto simulando o que ele "teria feito") —
  // antes do fix da C2 isso vira o pedido para `expired` no banco, e este
  // mesmo `transparent.completed` bate em `OrderNotPendingError` dentro do
  // webhook, disparando `flagManualRefund({reason:'order-expired'})`: o
  // alerta de estornar um pedido que estamos prestes a despachar, para um
  // provedor sem API de estorno. Depois do fix, order-expiry.ts exclui
  // `origin: 'casa_in_box'` da própria query — o pedido nunca entra no tick,
  // fica `pending`, e o webhook liquida pelo caminho normal.
  it('transparent.completed tardio para pedido de pré-venda com prazo vencido liquida normalmente, sem manual-refund, e envia o email (C2)', async () => {
    const order = await seedPresalePixOrder();
    const mailer = app.mailer as DevMailer;
    mailer.clear();
    Sentry.captureMessage.mockClear();

    // Tick real de order-expiry.ts, `now` depois do prazo do código Pix —
    // nunca um carimbo de data fixo.
    await runOrderExpiryTick({ stripe, now: new Date(order.expiresAt!.getTime() + 1000) });

    const res = await postWebhook(
      makeTransparentCompletedPayload(order.providerRef!, 'evt_pix_presale_late_1', {
        orderId: order.id,
      }),
    );

    expect(res.statusCode).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');
    expect(updated.confirmationEmailSentAt).not.toBeNull();

    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.to).toBe('comprador@exemplo.com');

    // Ponto central do teste: nenhum alerta de manual-refund (nem
    // 'order-expired', nem qualquer outro) saiu do caminho de liquidação.
    const manualRefundCalls = Sentry.captureMessage.mock.calls.filter((call) =>
      String(call[0]).includes('manual refund'),
    );
    expect(manualRefundCalls).toHaveLength(0);
  });

  // A (achado da revisão cruzada): existem DOIS caminhos pra um pedido sair
  // de `pending`, e só o do cron de expiração (C2) tinha reabertura. Um Pix
  // pode ser capturado pelo provedor DEPOIS do pedido já ter virado `failed`
  // via `transparent.lost` — AbacatePayClient não tem método de estorno, então
  // a instrução de estorno manual que o ramo genérico dispara nem dá pra
  // cumprir. Espelha o ramo `presale-recovered` que stripe-webhook.ts já tem.
  it('transparent.lost marca failed; transparent.completed depois para o mesmo billing recupera, sem manual-refund (A)', async () => {
    const order = await seedPresalePixOrder();
    const mailer = app.mailer as DevMailer;
    mailer.clear();
    Sentry.captureMessage.mockClear();

    const lostRes = await postWebhook(
      makeTransparentLostPayload(order.providerRef!, 'evt_pix_presale_lost_1', {
        orderId: order.id,
      }),
    );
    expect(lostRes.statusCode).toBe(200);

    const afterLost = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterLost.status).toBe('failed');

    const completedRes = await postWebhook(
      makeTransparentCompletedPayload(order.providerRef!, 'evt_pix_presale_recovered_1', {
        orderId: order.id,
      }),
    );

    expect(completedRes.statusCode).toBe(200);
    const afterRecovered = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterRecovered.status).toBe('paid');
    expect(afterRecovered.confirmationEmailSentAt).not.toBeNull();

    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.to).toBe('comprador@exemplo.com');

    // Ponto central do teste: nenhum alerta de manual-refund saiu do caminho
    // de recuperação — a Pix não tem API de estorno, então o alerta genérico
    // pede algo impossível de cumprir.
    const manualRefundCalls = Sentry.captureMessage.mock.calls.filter((call) =>
      String(call[0]).includes('manual refund'),
    );
    expect(manualRefundCalls).toHaveLength(0);
  });
});
