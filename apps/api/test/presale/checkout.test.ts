import { PRESALE_SYSTEM_USER_EMAIL, prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import { PRESALE_GARAGE_PATHS, presaleCheckoutResponseSchema } from '@ccc/shared/presale';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { verifyQrCode } from '../../src/lib/qr.js';
import type { CreateCheckoutSessionInput } from '../../src/services/stripe/index.js';
import { stripeIdempotencyConflictError, type FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';

const CHECKOUT_URL = '/presale/casa-in-box/checkout';
const CEP_RANGES = [{ start: '80000000', end: '82999999' }];
const IN_AREA_CEP = '80010-000';
const OUT_OF_AREA_CEP = '01310-100';

const delivery = (postalCode = IN_AREA_CEP) => ({
  recipientName: 'Comprador Teste',
  line1: 'Rua Exemplo',
  number: '100',
  district: 'Centro',
  city: 'Curitiba',
  stateCode: 'PR',
  postalCode,
});

const lastSessionInput = (stripe: FakeStripe): CreateCheckoutSessionInput => {
  const call = [...stripe.calls].reverse().find((c) => c.kind === 'createCheckoutSession');
  if (!call) throw new Error('createCheckoutSession não foi chamado');
  return call.payload as CreateCheckoutSessionInput;
};

describe('POST /presale/casa-in-box/checkout', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let variantId: string;
  let productId: string;
  let requestCounter = 0;

  beforeEach(async () => {
    await resetDatabase();
    // PresaleSettings não é limpa por resetDatabase (test/helpers.ts é
    // compartilhado pela suíte inteira e fica intocado): zera aqui.
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({
      enabled: true,
      shippingFeeCents: 1990,
      deliveryCepRanges: CEP_RANGES,
    });

    const product = await createPresaleProduct({ allowPickup: true, allowShip: true });
    productId = product.id;
    variantId = product.variants[0]!.id;

    const built = await makeAppWithFakeStripe();
    app = built.app;
    stripe = built.stripe;
  });

  afterEach(async () => {
    await app.close();
  });

  const payload = (overrides: Record<string, unknown> = {}) => ({
    clientRequestId: `req-${++requestCounter}-${Math.random().toString(36).slice(2, 10)}`,
    expectedTotalCents: 19800,
    fulfillmentMethod: 'pickup',
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
    checkoutUrl?: string;
    amountCents?: number;
    shippingCents?: number;
    currency?: string;
    code?: string;
    message?: string;
    variantIds?: string[];
    totalCents?: number;
  };

  const body = (res: Awaited<ReturnType<typeof post>>) => res.json() as CheckoutBody;

  it('cria o pedido e devolve a sessão Stripe no formato público', async () => {
    const res = await post();

    expect(res.statusCode).toBe(201);
    const parsed = presaleCheckoutResponseSchema.parse(res.json());
    expect(parsed.amountCents).toBe(19800);
    expect(parsed.shippingCents).toBe(0);
    expect(parsed.currency).toBe('BRL');
    expect(parsed.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: parsed.orderId } });
    expect(order.origin).toBe('casa_in_box');
    expect(order.kind).toBe('product');
    expect(order.method).toBe('card');
    expect(order.provider).toBe('stripe');
    expect(order.status).toBe('pending');
    expect(order.amountCents).toBe(19800);
    expect(order.baseAmountCents).toBe(19800);
    expect(order.shippingCents).toBe(0);
    expect(order.quantity).toBe(2);
    expect(order.fulfillmentMethod).toBe('pickup');
    expect(order.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');
  });

  it('503 quando a campanha está desligada', async () => {
    await setPresaleSettings({ enabled: false });

    const res = await post();
    expect(res.statusCode).toBe(503);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
  });

  it('soma linhas repetidas do mesmo variantId numa só', async () => {
    const res = await post({
      items: [
        { variantId, quantity: 2 },
        { variantId, quantity: 3 },
      ],
      expectedTotalCents: 5 * 9900,
    });

    expect(res.statusCode).toBe(201);
    const items = await prisma.orderItem.findMany({ where: { orderId: body(res).orderId } });
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(5);
    expect(items[0]!.unitPriceCents).toBe(9900);
    expect(items[0]!.subtotalCents).toBe(49500);
  });

  it('422 quando as linhas somadas passam do teto de 20 por variante', async () => {
    // O schema limita 1..20 POR LINHA e aceita 50 linhas. Depois que a Ruling 8
    // mandou somar linhas repetidas, só esta checagem impede 50x20 = 1000
    // unidades da mesma variante num pedido só.
    const res = await post({
      items: [
        { variantId, quantity: 20 },
        { variantId, quantity: 20 },
      ],
      expectedTotalCents: 40 * 9900,
    });

    expect(res.statusCode).toBe(422);
    expect(body(res).code).toBe('PRESALE_QUANTITY_TOO_HIGH');
    expect(body(res).variantIds).toEqual([variantId]);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
    expect(stripe.calls).toHaveLength(0);
  });

  it('cobra o frete uma vez só, não por linha', async () => {
    const res = await post({
      fulfillmentMethod: 'ship',
      delivery: delivery(),
      items: [
        { variantId, quantity: 1 },
        { variantId, quantity: 1 },
      ],
      expectedTotalCents: 2 * 9900 + 1990,
    });

    expect(res.statusCode).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: body(res).orderId } });
    expect(order.shippingCents).toBe(1990);
    expect(order.amountCents).toBe(21790);
    expect(order.fulfillmentMethod).toBe('ship');
  });

  it('409 e nenhum pedido quando expectedTotalCents diverge', async () => {
    const res = await post({ expectedTotalCents: 1 });

    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_TOTAL_CHANGED');
    expect(body(res).totalCents).toBe(19800);
    // As três tabelas que a transação escreve, não só Order: contar pedido
    // sozinho só implica as outras duas para quem já conhece o formato da
    // transação, e é justamente isso que um teste não deve exigir do leitor.
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
    await expect(prisma.presaleGuest.count()).resolves.toBe(0);
    await expect(prisma.consent.count()).resolves.toBe(0);
    expect(stripe.calls).toHaveLength(0);
  });

  it('ignora preço mandado pelo cliente e cobra o do banco', async () => {
    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        ...payload(),
        items: [{ variantId, quantity: 2, priceCents: 1, unitPriceCents: 1 }],
      },
    });

    expect(res.statusCode).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: body(res).orderId } });
    expect(order.amountCents).toBe(19800);
    expect(lastSessionInput(stripe).amountCents).toBe(19800);
  });

  it('grava devFeePercent 0 e devFeeAmountCents 0', async () => {
    const res = await post();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body(res).orderId } });
    expect(order.devFeePercent).toBe(0);
    expect(order.devFeeAmountCents).toBe(0);
  });

  it('não reserva estoque: quantitySold fica igual', async () => {
    const before = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });

    const res = await post();
    expect(res.statusCode).toBe(201);

    const after = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
    expect(after.quantitySold).toBe(before.quantitySold);
  });

  it('deixa expiresAt nulo', async () => {
    const res = await post();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body(res).orderId } });
    expect(order.expiresAt).toBeNull();
  });

  it.each([
    ['flag desmarcado', { visibleInPresale: false }],
    ['produto draft', { status: 'draft' as const }],
    ['produto virtual', { virtual: true }],
  ])('recusa %s nomeando o variantId', async (_label, patch) => {
    await prisma.product.update({ where: { id: productId }, data: patch });

    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_ITEM_UNAVAILABLE');
    expect(body(res).variantIds).toEqual([variantId]);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
  });

  it('recusa variante inativa nomeando o variantId', async () => {
    await prisma.variant.update({ where: { id: variantId }, data: { active: false } });

    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_ITEM_UNAVAILABLE');
    expect(body(res).variantIds).toEqual([variantId]);
  });

  it('recusa variantId inexistente nomeando o id', async () => {
    const res = await post({ items: [{ variantId: 'var_inexistente', quantity: 1 }] });

    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_ITEM_UNAVAILABLE');
    expect(body(res).variantIds).toEqual(['var_inexistente']);
  });

  it('422 com mensagem própria quando o total é zero', async () => {
    await prisma.variant.update({ where: { id: variantId }, data: { priceCents: 0 } });

    const res = await post({ expectedTotalCents: 0 });
    expect(res.statusCode).toBe(422);
    expect(body(res).code).toBe('PRESALE_TOTAL_TOO_LOW');
    expect(body(res).message).toMatch(/\S/);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
    expect(stripe.calls).toHaveLength(0);
  });

  it('422 quando o total fica abaixo do mínimo da Stripe em BRL', async () => {
    await prisma.variant.update({ where: { id: variantId }, data: { priceCents: 20 } });

    const res = await post({ items: [{ variantId, quantity: 1 }], expectedTotalCents: 20 });
    expect(res.statusCode).toBe(422);
    expect(body(res).code).toBe('PRESALE_TOTAL_TOO_LOW');
  });

  it('503 PRESALE_SETTINGS_INVALID quando deliveryCepRanges está corrompido, nunca 422 de CEP fora da área', async () => {
    // Faixa ilegível não é "fora de área": é configuração quebrada, e precisa
    // responder como erro nosso, não como se o comprador tivesse digitado um
    // CEP que não entregamos. `{ start: 'x' }` sem `end` falha
    // presaleCepRangeSchema de propósito — bypassa o admin direto no banco,
    // porque é exatamente o que o admin rejeitaria.
    await setPresaleSettings({ deliveryCepRanges: [{ start: '80000000' }] });

    const res = await post({
      fulfillmentMethod: 'ship',
      delivery: delivery(),
      expectedTotalCents: 19800 + 1990,
    });

    expect(res.statusCode).toBe(503);
    expect(body(res).code).toBe('PRESALE_SETTINGS_INVALID');
    expect(body(res).code).not.toBe('PRESALE_CEP_OUT_OF_AREA');
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
  });

  it('recusa entrega com CEP fora da faixa', async () => {
    const res = await post({
      fulfillmentMethod: 'ship',
      delivery: delivery(OUT_OF_AREA_CEP),
      expectedTotalCents: 19800 + 1990,
    });

    expect(res.statusCode).toBe(422);
    expect(body(res).code).toBe('PRESALE_CEP_OUT_OF_AREA');
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
  });

  it('recusa entrega quando o produto não tem allowShip', async () => {
    await prisma.product.update({ where: { id: productId }, data: { allowShip: false } });

    const res = await post({
      fulfillmentMethod: 'ship',
      delivery: delivery(),
      expectedTotalCents: 19800 + 1990,
    });

    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_FULFILLMENT_UNAVAILABLE');
    expect(body(res).variantIds).toEqual([variantId]);
  });

  it('recusa retirada quando o produto não tem allowPickup', async () => {
    await prisma.product.update({ where: { id: productId }, data: { allowPickup: false } });

    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_FULFILLMENT_UNAVAILABLE');
    expect(body(res).variantIds).toEqual([variantId]);
  });

  it('grava PresaleGuest e aponta o pedido para o usuário-sistema', async () => {
    const res = await post({
      fulfillmentMethod: 'ship',
      delivery: delivery(),
      expectedTotalCents: 19800 + 1990,
      guest: { name: 'Comprador Teste', email: 'comprador@exemplo.com', phone: '41999990000' },
    });

    expect(res.statusCode).toBe(201);
    const systemUser = await prisma.user.findUniqueOrThrow({
      where: { email: PRESALE_SYSTEM_USER_EMAIL },
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: body(res).orderId } });
    expect(order.userId).toBe(systemUser.id);

    const guest = await prisma.presaleGuest.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(guest.email).toBe('comprador@exemplo.com');
    expect(guest.phone).toBe('41999990000');
    expect(guest.recipientName).toBe('Comprador Teste');
    expect(guest.postalCode).toBe(IN_AREA_CEP);
    expect(guest.city).toBe('Curitiba');
  });

  it('não grava endereço no PresaleGuest quando é retirada', async () => {
    const res = await post();

    const guest = await prisma.presaleGuest.findUniqueOrThrow({
      where: { orderId: body(res).orderId },
    });
    expect(guest.line1).toBeNull();
    expect(guest.postalCode).toBeNull();
    expect(guest.recipientName).toBeNull();
  });

  it('nenhuma linha de User é criada ou alterada pelo email do convidado', async () => {
    await createUser({ email: 'membro@existente.com', name: 'Nome Original' });
    // Aquece o usuário-sistema para que a contagem não mude por causa dele.
    await post();
    const before = await prisma.user.count();

    const res = await post({
      guest: { name: 'Outro Nome', email: 'membro@existente.com' },
    });
    expect(res.statusCode).toBe(201);

    await expect(prisma.user.count()).resolves.toBe(before);
    const membro = await prisma.user.findUniqueOrThrow({
      where: { email: 'membro@existente.com' },
    });
    expect(membro.name).toBe('Nome Original');
  });

  it('clique duplo com o mesmo clientRequestId devolve o mesmo pedido e a mesma URL', async () => {
    const twice = payload();

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice }),
      app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice }),
    ]);

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(body(a).orderId).toBe(body(b).orderId);
    expect(body(a).checkoutUrl).toBe(body(b).checkoutUrl);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(1);
  });

  it('irmã que perde a corrida da unique não marca failed quando a Stripe recusa', async () => {
    // A metade um do bug crítico. Estado reproduzido: o pedido existe,
    // continua `pending` e AINDA NÃO tem checkoutUrl, porque a criadora segue
    // em voo na Stripe. A irmã chega com o mesmo clientRequestId, bate em
    // P2002, pede a MESMA chave de idempotência e leva 409
    // `idempotency_key_in_use` — que significa "o outro está trabalhando", e
    // não "o pagamento falhou". Antes da correção, ela marcava o pedido
    // `failed` a partir desse erro; a criadora então gravava a URL VIVA num
    // pedido morto e devolvia 201, a pessoa pagava, e o webhook ficava em 500
    // eterno com o dinheiro capturado.
    const twice = payload();

    const first = await app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice });
    expect(first.statusCode).toBe(201);
    const orderId = body(first).orderId;
    await prisma.order.update({ where: { id: orderId }, data: { checkoutUrl: null } });

    stripe.nextCheckoutSessionError = stripeIdempotencyConflictError();
    const sibling = await app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice });

    expect(sibling.statusCode).toBe(502);
    expect(body(sibling).checkoutUrl).toBeUndefined();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending');
    expect(order.failedAt).toBeNull();
  });

  it('não entrega URL pagável se o pedido sair de pending enquanto a Stripe responde', async () => {
    // A metade dois: defesa em profundidade na escrita da criadora. O fake
    // tira o pedido de `pending` DENTRO da chamada da Stripe, que é o que uma
    // irmã (ou qualquer outro caminho) faria na janela real. Antes da
    // correção, a escrita era `update` por id, sem status no where: gravava a
    // URL viva num pedido `failed` e devolvia 201.
    const realCreate = stripe.createCheckoutSession;
    stripe.createCheckoutSession = async (input) => {
      await prisma.order.updateMany({
        where: { origin: 'casa_in_box', status: 'pending' },
        data: { status: 'failed', failedAt: new Date() },
      });
      return realCreate(input);
    };

    const res = await post();

    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe('PRESALE_REQUEST_STALE');
    expect(body(res).checkoutUrl).toBeUndefined();

    // A invariante que fecha o buraco: nenhum pedido fica `failed` carregando
    // uma checkoutUrl, e ninguém recebeu URL de pedido que não está `pending`.
    const order = await prisma.order.findFirstOrThrow({ where: { origin: 'casa_in_box' } });
    expect(order.status).toBe('failed');
    expect(order.checkoutUrl).toBeNull();
  });

  it('409 quando o clientRequestId reincide sobre pedido não-pendente', async () => {
    const twice = payload();

    const first = await app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice });
    expect(first.statusCode).toBe(201);
    await prisma.order.update({
      where: { id: body(first).orderId },
      data: { status: 'failed', failedAt: new Date() },
    });

    const second = await app.inject({ method: 'POST', url: CHECKOUT_URL, payload: twice });
    expect(second.statusCode).toBe(409);
    expect(body(second).code).toBe('PRESALE_REQUEST_STALE');
    expect(body(second).checkoutUrl).toBeUndefined();
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(1);
  });

  it('expires_at da sessão é no mínimo 30 min à frente da criação', async () => {
    await post();

    const input = lastSessionInput(stripe);
    expect(input.expiresAt! - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(30 * 60 - 5);
  });

  it('usa idempotencyKey derivada do orderId e manda orderId na metadata', async () => {
    const res = await post();

    const input = lastSessionInput(stripe);
    expect(input.idempotencyKey).toBe(`presale_checkout_${body(res).orderId}`);
    expect(input.metadata).toMatchObject({ orderId: body(res).orderId });
  });

  it('monta success_url e cancel_url no servidor, com token assinado do pedido', async () => {
    const env = loadEnv();
    const res = await post();
    const orderId = body(res).orderId;

    const input = lastSessionInput(stripe);
    expect(input.cancelUrl).toBe(`${env.GARAGE_WEB_BASE_URL}${PRESALE_GARAGE_PATHS.landing}`);

    const success = new URL(input.successUrl);
    expect(success.origin + success.pathname).toBe(
      `${env.GARAGE_WEB_BASE_URL}/casa-in-box/obrigado`,
    );
    expect(success.searchParams.get('orderId')).toBe(orderId);
    expect(verifyQrCode(success.searchParams.get('t')!, env)).toEqual({ kind: 'p', id: orderId });
  });

  it('ignora success_url e cancel_url mandados no corpo', async () => {
    const env = loadEnv();
    await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        ...payload(),
        successUrl: 'https://evil.example/pago',
        cancelUrl: 'https://evil.example/cancelado',
      },
    });

    const input = lastSessionInput(stripe);
    expect(input.successUrl.startsWith(env.GARAGE_WEB_BASE_URL)).toBe(true);
    expect(input.cancelUrl.startsWith(env.GARAGE_WEB_BASE_URL)).toBe(true);
  });

  it('falha da Stripe deixa o pedido failed e não cobra', async () => {
    stripe.nextCheckoutSessionError = new Error('stripe fora do ar');

    const res = await post();
    expect(res.statusCode).toBe(502);

    const order = await prisma.order.findFirstOrThrow({ where: { origin: 'casa_in_box' } });
    expect(order.status).toBe('failed');
    expect(order.failedAt).not.toBeNull();
    expect(order.checkoutUrl).toBeNull();
  });

  it('grava consentimento com canal web_public e evidence preenchido', async () => {
    await post();

    const consent = await prisma.consent.findFirstOrThrow({ where: { purpose: 'privacy_notice' } });
    expect(consent.channel).toBe('web_public');
    expect(consent.version).toBe(PRIVACY_POLICY_VERSION);
    expect(consent.userId).toBeNull();
    expect(consent.evidence).not.toBeNull();
    expect(consent.evidence).toMatchObject({ guestEmail: 'comprador@exemplo.com' });
  });

  it('422 quando o corpo não passa no schema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: { ...payload(), items: [] },
    });

    expect(res.statusCode).toBe(422);
    await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
  });

  it('o checkout tem teto de rate limit próprio, menor que o das rotas de leitura', async () => {
    const read = await app.inject({ method: 'GET', url: '/presale/casa-in-box/campaign' });
    const write = await post();

    expect(Number(write.headers['x-ratelimit-limit'])).toBeLessThan(
      Number(read.headers['x-ratelimit-limit']),
    );
  });
});
