import { ensurePresaleSystemUser, prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import { presaleCheckoutResponseSchema } from '@ccc/shared/presale';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { verifyQrCode } from '../../src/lib/qr.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { DevMailer } from '../../src/services/mailer/dev.js';
import {
  ensurePixBilling,
  type CreatePresaleOrderDeps,
} from '../../src/services/presale/checkout.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { makeAppWithFakes, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';

const CHECKOUT_URL = '/presale/casa-in-box/checkout';
const STATUS_URL = '/presale/casa-in-box/orders/status';

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
    statusUrl?: string;
    checkoutUrl?: string;
    amountCents?: number;
    shippingCents?: number;
    currency?: string;
    code?: string;
    message?: string;
  };

  const body = (res: Awaited<ReturnType<typeof post>>) => res.json() as CheckoutBody;

  const pixCalls = () => abacatepay.calls.filter((c) => c.method === 'createPixBilling');

  const deps = (): CreatePresaleOrderDeps => ({
    stripe: app.stripe,
    abacatepay: app.abacatepay,
    mailer: app.mailer,
    env: app.env,
    log: app.log,
  });

  // Pedido pendente de Pix criado direto no banco (fora do fluxo HTTP), para
  // chamar `ensurePixBilling` isolado e testar a reivindicação de forma
  // determinística — sem Promise.all, sem depender do timing do fake.
  const createPendingPixOrder = async (
    overrides: Partial<{ expiresAt: Date | null; brCode: string | null }> = {},
  ) => {
    const userId = await ensurePresaleSystemUser();
    return prisma.order.create({
      data: {
        userId,
        kind: 'product',
        origin: 'casa_in_box',
        clientRequestId: `claim-race-${Math.random().toString(36).slice(2, 10)}`,
        amountCents: 19800,
        baseAmountCents: 19800,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: 'BRL',
        method: 'pix',
        provider: 'abacatepay',
        status: 'pending',
        quantity: 2,
        shippingCents: 0,
        fulfillmentMethod: 'pickup',
        expiresAt: overrides.expiresAt ?? null,
        brCode: overrides.brCode ?? null,
      },
    });
  };

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

  // T2-C1: a Stripe fecha o clique duplo sozinha com idempotencyKey; o
  // AbacatePay não tem esse conceito (recusa campo desconhecido com 422), e
  // o teste acima só prova "funcionou desta vez" porque o fake responde
  // rápido demais para abrir a corrida de verdade. Os dois testes abaixo
  // prendem o MECANISMO (a reivindicação via compare-and-set em
  // `Order.expiresAt`) de forma determinística, sem depender de nenhum
  // timing: escrevem o estado que uma requisição concorrente já teria
  // deixado, e chamam `ensurePixBilling` isolado.
  it('T2-C1: reivindicação já em voo (expiresAt preenchido, brCode ainda não) nunca chama o provedor', async () => {
    const order = await createPendingPixOrder({ expiresAt: new Date(Date.now() + 3600_000) });

    const result = await ensurePixBilling(order, deps());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('esperava a resposta retentável');
    expect(result.status).toBe(502);
    expect(result.code).toBe('PRESALE_PROVIDER_ERROR');
    expect(pixCalls()).toHaveLength(0);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.brCode).toBeNull();
    expect(after.providerRef).toBeNull();
    expect(after.status).toBe('pending');
  });

  it('T2-C1: reivindicação perdida mas vencedora já terminou devolve o brCode dela, sem chamar o provedor de novo', async () => {
    const winnerExpiresAt = new Date(Date.now() + 3600_000);
    const order = await createPendingPixOrder({
      expiresAt: winnerExpiresAt,
      brCode: 'ja-cobrado-pela-vencedora',
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { providerRef: 'pix_char_vencedora' },
    });
    // `order` (o objeto em mãos) é a leitura ANTERIOR à vitória da outra
    // requisição: ainda tem brCode nulo, como quem perdeu a corrida de
    // verdade teria.
    const stale = { ...order, brCode: null, providerRef: null, expiresAt: null };

    const result = await ensurePixBilling(stale, deps());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('esperava sucesso');
    if (result.paymentMethod !== 'pix') throw new Error('esperava resposta pix');
    expect(result.brCode).toBe('ja-cobrado-pela-vencedora');
    expect(result.pixExpiresAt).toBe(winnerExpiresAt.toISOString());
    expect(pixCalls()).toHaveLength(0);
  });

  // T3-I1 (fix round 2): sendPresalePixCodeEmail agora solta o carimbo
  // quando o envio falha, então o clique duplo que bate no curto-circuito
  // `if (order.brCode) ...` de ensurePixBilling precisa tentar o email de
  // novo — é exatamente o que um comprador faz quando a mensagem não chegou.
  it('T3-I1: clique duplo depois da primeira entrega falhar reenvia o email pelo curto-circuito idempotente', async () => {
    const twice = payload();

    const first = await app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice });
    expect(first.statusCode).toBe(201);
    const orderId = body(first).orderId;

    // Estado que sendPresalePixCodeEmail deixa quando o mailer falha: o
    // carimbo solto, com o brCode já gravado pela primeira passagem.
    await prisma.order.update({
      where: { id: orderId },
      data: { pixCodeEmailSentAt: null },
    });

    const mailer = app.mailer as DevMailer;
    mailer.clear();

    // Mesmo clientRequestId: cai no `if (order.brCode) return succeedPix(...)`
    // dentro de ensurePixBilling, sem chamar o AbacatePay de novo.
    const second = await app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice });

    expect(second.statusCode).toBe(201);
    expect(body(second).orderId).toBe(orderId);
    expect(pixCalls()).toHaveLength(1);

    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.to).toBe('comprador@exemplo.com');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.pixCodeEmailSentAt).not.toBeNull();
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

    // Union .strict(): cartão não carrega statusUrl, que é exclusivo do ramo
    // pix. Checa o JSON cru, não só o tipo estreitado pelo parse acima.
    expect((res.json() as CheckoutBody).statusUrl).toBeUndefined();
  });

  // CRITICAL fix: o ramo pix da resposta não carregava token/URL nenhum, e o
  // comprador caía na tela de status sem conseguir consultá-lo — o link do
  // email funcionava (montado no servidor com token) porque o redirect
  // imediato não. `statusUrl` tem que vir montado pelo MESMO par que o
  // success_url do cartão já usa: signQrCode('p', ...) + presaleOrderStatusUrl.
  describe('statusUrl no ramo pix', () => {
    const env = loadEnv();

    it('vem montado pelo helper compartilhado, com orderId e token válidos', async () => {
      const res = await post();
      expect(res.statusCode).toBe(201);
      const parsed = presaleCheckoutResponseSchema.parse(res.json());
      if (parsed.paymentMethod !== 'pix') throw new Error('esperava resposta pix');

      const statusUrl = new URL(parsed.statusUrl);
      expect(statusUrl.origin + statusUrl.pathname).toBe(
        `${env.GARAGE_WEB_BASE_URL}/casa-in-box/obrigado`,
      );
      expect(statusUrl.searchParams.get('orderId')).toBe(parsed.orderId);
      const token = statusUrl.searchParams.get('t');
      expect(token).toBeTruthy();
      // Montado pelo helper, não à mão: o kind tem que ser 'p' e o id tem
      // que bater com o orderId — exatamente o que verifyQrCode valida.
      expect(verifyQrCode(token!, env)).toEqual({ kind: 'p', id: parsed.orderId });
    });

    it('o token do statusUrl é ACEITO pela rota de status daquele pedido (atravessa a costura)', async () => {
      const res = await post();
      const parsed = presaleCheckoutResponseSchema.parse(res.json());
      if (parsed.paymentMethod !== 'pix') throw new Error('esperava resposta pix');

      const statusUrl = new URL(parsed.statusUrl);
      const token = statusUrl.searchParams.get('t')!;

      const statusRes = await app.inject({
        method: 'POST',
        url: STATUS_URL,
        payload: { orderId: parsed.orderId, token },
      });

      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json()).toMatchObject({ orderId: parsed.orderId });
    });

    it('o token de um pedido NÃO serve para outro', async () => {
      const first = await post();
      const second = await post();
      const firstOrder = presaleCheckoutResponseSchema.parse(first.json());
      const secondOrder = presaleCheckoutResponseSchema.parse(second.json());
      if (firstOrder.paymentMethod !== 'pix' || secondOrder.paymentMethod !== 'pix') {
        throw new Error('esperava resposta pix');
      }

      const firstToken = new URL(firstOrder.statusUrl).searchParams.get('t')!;

      // Token do primeiro pedido, orderId do segundo: a rota tem que recusar.
      const crossRes = await app.inject({
        method: 'POST',
        url: STATUS_URL,
        payload: { orderId: secondOrder.orderId, token: firstToken },
      });

      expect(crossRes.statusCode).toBe(404);
    });
  });
});
