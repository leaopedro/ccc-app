/**
 * Checkout da pré-venda Casa In Box: recálculo no servidor e sessão Stripe.
 *
 * Duas fronteiras aqui NÃO são estilo, são dinheiro:
 *
 * 1. A chamada da Stripe fica FORA da transação. A transação cobre validação,
 *    recálculo, comparação com `expectedTotalCents` e a criação de Order +
 *    OrderItem + PresaleGuest + Consent. Só depois do commit é que a sessão
 *    nasce. Se um timeout de transação interativa abortasse DEPOIS de a Stripe
 *    já ter criado a sessão, existiria uma sessão pagável apontando para um
 *    `orderId` que o rollback apagou, e `routes/stripe-webhook.ts:891-928`
 *    não trata `OrderNotFoundError` — viraria 500 eterno com o dinheiro
 *    capturado. `routes/cart.ts:883` chama a Stripe depois do commit pelo
 *    mesmo motivo.
 *
 * 2. `expires_at` da sessão é recalculado NA HORA da chamada. A Stripe exige
 *    no mínimo 30 minutos a partir da criação da sessão; reaproveitar um
 *    carimbo feito alguns passos antes dá sempre um valor curto e todo
 *    checkout tomaria 400. Veja `routes/cart.ts:798`.
 *
 * E uma coisa que este arquivo deliberadamente NÃO faz: reservar estoque.
 * Nada de `quantitySold: { increment }`. O débito acontece na liquidação.
 * Reserva num POST anônimo deixaria qualquer um esgotar a campanha de graça,
 * e o rate limit não defende porque `trustProxy` está desligado
 * (`app.ts:99-103`). Como não há reserva, `Order.expiresAt` fica NULO: o
 * worker (`workers/order-expiry.ts:124`) filtra `expiresAt: { not: null }`,
 * então nulo o mantém fora e ninguém mata o pedido no meio do 3DS. Quem fecha
 * a janela é o `expires_at` da própria sessão.
 */

import { ensurePresaleSystemUser, prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import {
  PRESALE_GARAGE_PATHS,
  PRESALE_MAX_QTY_PER_VARIANT,
  PRESALE_SETTINGS_SINGLETON_ID,
  presaleCepRangesSchema,
  presaleOrderStatusUrl,
  type PresaleCheckoutRequest,
} from '@ccc/shared/presale';
import type { Order } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import { isUniqueConstraintErrorOn } from '../../lib/prisma-errors.js';
import { signQrCode } from '../../lib/qr.js';
import type { StripeClient } from '../stripe/index.js';

import { PRESALE_PRODUCT_WHERE } from './eligibility.js';
import { cepInRanges, computePresaleTotals } from './totals.js';

/** Mínimo que a Stripe aceita cobrar em BRL: R$ 0,50. */
const STRIPE_MIN_BRL_CENTS = 50;

/** TTL da sessão hospedada. A Stripe exige >= 30 min a partir da criação. */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Aparece no recibo e na página da Stripe. */
const SESSION_PRODUCT_NAME = 'Casa In Box (pré-venda)';

export type PresaleCheckoutErrorCode =
  | 'PRESALE_DISABLED'
  | 'PRESALE_SETTINGS_INVALID'
  | 'PRESALE_ITEM_UNAVAILABLE'
  | 'PRESALE_QUANTITY_TOO_HIGH'
  | 'PRESALE_FULFILLMENT_UNAVAILABLE'
  | 'PRESALE_CEP_OUT_OF_AREA'
  | 'PRESALE_TOTAL_CHANGED'
  | 'PRESALE_TOTAL_TOO_LOW'
  | 'PRESALE_REQUEST_STALE'
  | 'PRESALE_PROVIDER_ERROR';

export type CreatePresaleOrderInput = PresaleCheckoutRequest & {
  /** Prova de consentimento. Vale pouco enquanto `trustProxy` estiver
   *  desligado (grava o proxy do Railway, igual para todos), mas grava. */
  ipAddress: string | null;
  userAgent: string | null;
};

export type CreatePresaleOrderDeps = {
  stripe: StripeClient;
  env: { TICKET_CODE_SECRET: string; GARAGE_WEB_BASE_URL: string };
  log: FastifyBaseLogger;
};

export type CreatePresaleOrderSuccess = {
  ok: true;
  orderId: string;
  checkoutUrl: string;
  amountCents: number;
  shippingCents: number;
  currency: string;
};

export type CreatePresaleOrderFailure = {
  ok: false;
  status: number;
  error: string;
  code: PresaleCheckoutErrorCode;
  message: string;
  /** Itens ofensores, para a montagem marcá-los na tela e revalidar. */
  variantIds?: string[];
  /** Só em PRESALE_TOTAL_CHANGED: o total recalculado pelo servidor. */
  totalCents?: number;
};

export type CreatePresaleOrderResult = CreatePresaleOrderSuccess | CreatePresaleOrderFailure;

const fail = (
  status: number,
  error: string,
  code: PresaleCheckoutErrorCode,
  message: string,
  extra: { variantIds?: string[]; totalCents?: number } = {},
): CreatePresaleOrderFailure => ({ ok: false, status, error, code, message, ...extra });

/** Linhas repetidas do mesmo variantId viram UMA, com as quantidades somadas.
 *  Sem isto o pedido ganharia dois OrderItem para a mesma variante. */
const normalizeItems = (
  items: PresaleCheckoutRequest['items'],
): Array<{ variantId: string; quantity: number }> => {
  const byVariant = new Map<string, number>();
  for (const item of items) {
    byVariant.set(item.variantId, (byVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  return [...byVariant].map(([variantId, quantity]) => ({ variantId, quantity }));
};

const succeed = (order: Order, checkoutUrl: string): CreatePresaleOrderSuccess => ({
  ok: true,
  orderId: order.id,
  checkoutUrl,
  amountCents: order.amountCents,
  shippingCents: order.shippingCents,
  currency: order.currency,
});

/**
 * Garante que o pedido tenha uma sessão Stripe, e devolve a URL.
 *
 * Idempotente de propósito: já tendo `checkoutUrl` não chama a Stripe, e
 * quando chama usa sempre `presale_checkout_<orderId>` como chave de
 * idempotência. É isso que faz o clique duplo convergir — a segunda
 * requisição, que perdeu a corrida da unique e encontrou o pedido do
 * vencedor ainda sem URL, pede a MESMA sessão em vez de uma segunda.
 *
 * `ownsStripeAttempt` NÃO é um detalhe: diz se quem chama é dono da tentativa
 * de pagamento (criou o pedido) ou se é a irmã que perdeu a corrida da unique.
 * Só o dono pode mexer no status. A irmã compartilha a chave de idempotência
 * mas não a tentativa: a Stripe devolve 409 `idempotency_key_in_use` enquanto
 * a chamada do dono ainda está em voo, e isso é "o outro está trabalhando",
 * não "o pagamento falhou". Deixar a irmã marcar `failed` a partir desse erro
 * era um pedido pagável marcado como morto — o dono seguia, gravava a URL
 * viva num pedido já `failed`, devolvia 201, a pessoa pagava, e o webhook
 * entrava em 500 eterno com o dinheiro capturado (`OrderNotPendingError` em
 * `stripe-webhook.ts:913-926` não casa com `expired` nem `paid`, e `:928`
 * relança). `services/stripe/index.ts:423` não configura `maxNetworkRetries`,
 * então o clique duplo é o caminho comum para esse 409, não um caso exótico.
 */
const ensureCheckoutSession = async (
  order: Order,
  deps: CreatePresaleOrderDeps,
  opts: { ownsStripeAttempt: boolean },
): Promise<CreatePresaleOrderResult> => {
  if (order.checkoutUrl) return succeed(order, order.checkoutUrl);

  const base = deps.env.GARAGE_WEB_BASE_URL.replace(/\/+$/, '');
  // success_url e cancel_url são montadas AQUI, no servidor, nunca aceitas do
  // corpo. `routes/cart.ts:803` aceita `input.cancelUrl`, mas aquele fluxo é
  // autenticado; num endpoint público isso é redirect aberto e spoof de
  // confirmação de pagamento.
  const token = signQrCode('p', order.id, deps.env);
  // Rota e nomes de parâmetro vêm de @ccc/shared/presale, que é também de
  // onde a página do garage os lê. Digitar a querystring à mão aqui foi o
  // que mandou 100% dos compradores para a tela de "faltam parâmetros".
  const successUrl = presaleOrderStatusUrl(base, order.id, token);

  const providerFailure = () =>
    fail(
      502,
      'BadGateway',
      'PRESALE_PROVIDER_ERROR',
      'não foi possível iniciar o pagamento agora. Tente de novo em alguns instantes.',
    );

  // O `try` cobre A CHAMADA DA STRIPE e nada mais. Englobar a escrita no banco
  // aqui fazia um erro de banco ser logado como "Stripe recusou a sessão" e
  // devolvido como 502 do provedor, quando a Stripe tinha aceitado e existia
  // uma sessão viva sem ninguém apontando para ela — mentira para quem estiver
  // de plantão.
  let session;
  try {
    session = await deps.stripe.createCheckoutSession({
      amountCents: order.amountCents,
      currency: order.currency,
      productName: SESSION_PRODUCT_NAME,
      metadata: { orderId: order.id },
      successUrl,
      // Volta para a landing da pré-venda. `/casa-in-box/montar` era a rota
      // do builder, adiada pela emenda de 2026-11-10: clicar em voltar na
      // Stripe dava 404.
      cancelUrl: `${base}${PRESALE_GARAGE_PATHS.landing}`,
      idempotencyKey: `presale_checkout_${order.id}`,
      // Recalculado na hora da chamada. Nunca derivado de um carimbo anterior.
      expiresAt: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
    });
  } catch (err) {
    if (!opts.ownsStripeAttempt) {
      // Não é dona da tentativa: sai sem encostar no status. O dono ainda está
      // em voo e decide o destino do pedido.
      deps.log.warn(
        { err, orderId: order.id },
        '[presale-checkout] requisição irmã não obteve a sessão; status do pedido intocado',
      );
      return providerFailure();
    }

    deps.log.error({ err, orderId: order.id }, '[presale-checkout] Stripe recusou a sessão');
    // Não há reserva de estoque para devolver; só o pedido a marcar. Em
    // try/catch próprio: uma falha de banco AQUI não pode virar rejeição solta
    // e 500 na rota, escondendo o erro de provedor que é a causa real.
    try {
      await prisma.order.updateMany({
        where: { id: order.id, status: 'pending', checkoutUrl: null },
        data: { status: 'failed', failedAt: new Date() },
      });
    } catch (markErr) {
      deps.log.error(
        { err: markErr, orderId: order.id },
        '[presale-checkout] erro da Stripe, e ainda falhou ao marcar o pedido como failed',
      );
    }
    return providerFailure();
  }

  // Stripe aceitou. Daqui para baixo, falha é de BANCO, nunca de provedor.
  //
  // `status: 'pending'` no where é defesa em profundidade: se alguma coisa
  // tirou o pedido de `pending` enquanto a Stripe respondia, a URL NÃO pode
  // ser entregue. Um `update` por id, sem essa cláusula, gravava a URL viva
  // num pedido já `failed` e devolvia 201 — a pessoa pagava e o webhook ficava
  // em 500 eterno. A sessão órfã que sobra aqui é inalcançável, porque a URL
  // não sai desta função; nada é cobrado.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: 'pending' },
    data: { checkoutUrl: session.url },
  });
  if (claimed.count === 0) {
    deps.log.error(
      { orderId: order.id, sessionId: session.id },
      '[presale-checkout] sessão criada para pedido que saiu de pending; URL descartada',
    );
    return fail(
      409,
      'Conflict',
      'PRESALE_REQUEST_STALE',
      'esta tentativa de pagamento já foi encerrada. Tente de novo.',
    );
  }

  return succeed(order, session.url);
};

/** Resultado da transação: ou uma recusa já formatada, ou o pedido criado. */
type TransactionOutcome = CreatePresaleOrderFailure | { ok: true; order: Order };

export const createPresaleOrder = async (
  input: CreatePresaleOrderInput,
  deps: CreatePresaleOrderDeps,
): Promise<CreatePresaleOrderResult> => {
  // Fora da transação e idempotente: a linha do usuário-sistema não pertence
  // a este pedido, e nenhuma linha de User é criada a partir do email do
  // convidado — o email real vive só em PresaleGuest.
  const systemUserId = await ensurePresaleSystemUser();

  let created: Order;
  try {
    const outcome = await prisma.$transaction(async (tx): Promise<TransactionOutcome> => {
      // Leitura dentro da transação, com `findUnique` em vez de
      // `ensurePresaleSettings` (que é upsert no client global). A linha já
      // existe: o preHandler de routes/presale.ts a garante. Linha ausente
      // significa campanha desligada — falha fechado.
      const settings = await tx.presaleSettings.findUnique({
        where: { id: PRESALE_SETTINGS_SINGLETON_ID },
      });
      if (!settings?.enabled) {
        return fail(503, 'ServiceUnavailable', 'PRESALE_DISABLED', 'pré-venda está desligada');
      }

      const lines = normalizeItems(input.items);

      // `presaleCheckoutRequestSchema` limita 1..20 POR LINHA. Depois da soma
      // por variante o teto precisa valer de novo, senão 50 linhas de 20
      // comprariam 1000 unidades da mesma variante.
      const overQuota = lines
        .filter((line) => line.quantity > PRESALE_MAX_QTY_PER_VARIANT)
        .map((line) => line.variantId);
      if (overQuota.length > 0) {
        return fail(
          422,
          'UnprocessableEntity',
          'PRESALE_QUANTITY_TOO_HIGH',
          `máximo de ${PRESALE_MAX_QTY_PER_VARIANT} unidades por item`,
          { variantIds: overQuota },
        );
      }

      // Mesma regra de elegibilidade das três superfícies (Task 3). Importada,
      // nunca reescrita: um `where` paralelo deixaria um produto aparecer na
      // caixa e ser recusado no pagamento.
      const variants = await tx.variant.findMany({
        where: {
          id: { in: lines.map((line) => line.variantId) },
          active: true,
          product: PRESALE_PRODUCT_WHERE,
        },
        include: { product: true },
      });
      const byId = new Map(variants.map((variant) => [variant.id, variant]));

      const unavailable = lines
        .filter((line) => !byId.has(line.variantId))
        .map((line) => line.variantId);
      if (unavailable.length > 0) {
        return fail(
          409,
          'Conflict',
          'PRESALE_ITEM_UNAVAILABLE',
          'um ou mais itens saíram da pré-venda. Revise a caixa e tente de novo.',
          { variantIds: unavailable },
        );
      }

      const wrongFulfillment = lines
        .filter((line) => {
          const product = byId.get(line.variantId)!.product;
          return input.fulfillmentMethod === 'ship' ? !product.allowShip : !product.allowPickup;
        })
        .map((line) => line.variantId);
      if (wrongFulfillment.length > 0) {
        return fail(
          409,
          'Conflict',
          'PRESALE_FULFILLMENT_UNAVAILABLE',
          input.fulfillmentMethod === 'ship'
            ? 'um ou mais itens não podem ser entregues. Escolha a retirada ou revise a caixa.'
            : 'um ou mais itens não podem ser retirados. Escolha a entrega ou revise a caixa.',
          { variantIds: wrongFulfillment },
        );
      }

      if (input.fulfillmentMethod === 'ship') {
        // `delivery` é obrigatório para 'ship' pelo cruzamento do schema de
        // entrada (packages/shared/src/presale.ts).
        const ranges = presaleCepRangesSchema.safeParse(settings.deliveryCepRanges);
        // Faixa ilegível NÃO é "fora de área". Juntar os dois num `||` só
        // escondia uma configuração quebrada atrás de uma recusa que parece
        // normal: o comprador lia "não entregamos no seu CEP", ninguém via
        // alarme, e a entrega ficava invendável em silêncio. Erro nosso
        // responde como erro nosso, com log de erro e código próprio.
        if (!ranges.success) {
          deps.log.error(
            { issues: ranges.error.issues, settingsId: settings.id },
            '[presale-checkout] deliveryCepRanges ilegível; entrega indisponível até corrigir',
          );
          return fail(
            503,
            'ServiceUnavailable',
            'PRESALE_SETTINGS_INVALID',
            'a entrega está indisponível no momento. Você pode retirar na Pocket CASA.',
          );
        }
        if (!cepInRanges(input.delivery!.postalCode, ranges.data)) {
          return fail(
            422,
            'UnprocessableEntity',
            'PRESALE_CEP_OUT_OF_AREA',
            'ainda não entregamos neste CEP. Você pode retirar na Pocket CASA.',
          );
        }
      }

      // Preço SEMPRE do banco. O que o cliente mandou é ignorado.
      const priced = lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        priceCents: byId.get(line.variantId)!.priceCents,
      }));
      const totals = computePresaleTotals({
        items: priced,
        fulfillmentMethod: input.fulfillmentMethod,
        shippingFeeCents: settings.shippingFeeCents,
      });

      if (totals.totalCents !== input.expectedTotalCents) {
        return fail(
          409,
          'Conflict',
          'PRESALE_TOTAL_CHANGED',
          'o valor da caixa mudou. Confira o novo total antes de pagar.',
          { totalCents: totals.totalCents },
        );
      }

      if (totals.totalCents < STRIPE_MIN_BRL_CENTS) {
        return fail(
          422,
          'UnprocessableEntity',
          'PRESALE_TOTAL_TOO_LOW',
          'o valor da caixa é baixo demais para cobrar no cartão. Adicione um item.',
        );
      }

      const order = await tx.order.create({
        data: {
          userId: systemUserId,
          kind: 'product',
          origin: 'casa_in_box',
          clientRequestId: input.clientRequestId,
          amountCents: totals.totalCents,
          baseAmountCents: totals.subtotalCents,
          // A coluna tem default 10 no schema. Escritos explicitamente: a
          // pré-venda cobra o preço base puro, e omitir gravaria 10 aqui e a
          // contabilidade mentiria.
          devFeePercent: 0,
          devFeeAmountCents: 0,
          // Moeda da primeira linha que o cliente mandou. Isso só é seguro
          // porque PRESALE_PRODUCT_WHERE fixa `currency: 'BRL'`
          // (services/presale/eligibility.ts:16), então toda variante que
          // chega aqui tem a MESMA moeda e qualquer uma serve. Afrouxar aquele
          // pino sem mexer aqui vira cobrança de carrinho multimoeda somado
          // como se fosse um número só.
          currency: byId.get(priced[0]!.variantId)!.product.currency,
          method: 'card',
          provider: 'stripe',
          status: 'pending',
          quantity: priced.reduce((sum, item) => sum + item.quantity, 0),
          shippingCents: totals.shippingCents,
          fulfillmentMethod: input.fulfillmentMethod,
          // Sem reserva, expirar não libera nada — ver o cabeçalho do arquivo.
          expiresAt: null,
          items: {
            create: priced.map((item) => ({
              kind: 'product' as const,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPriceCents: item.priceCents,
              subtotalCents: item.priceCents * item.quantity,
            })),
          },
          presaleGuest: {
            create: {
              name: input.guest.name,
              email: input.guest.email,
              phone: input.guest.phone ?? null,
              recipientName: input.delivery?.recipientName ?? null,
              line1: input.delivery?.line1 ?? null,
              number: input.delivery?.number ?? null,
              district: input.delivery?.district ?? null,
              city: input.delivery?.city ?? null,
              stateCode: input.delivery?.stateCode ?? null,
              postalCode: input.delivery?.postalCode ?? null,
            },
          },
        },
      });

      // `evidence` é obrigatório e não tem default no schema: o insert quebra
      // se for omitido. `userId` fica nulo de propósito — o convidado não tem
      // conta, e apontar para o usuário-sistema colapsaria o consentimento de
      // todo mundo numa linha só. Quem consentiu está no evidence.
      await tx.consent.create({
        data: {
          userId: null,
          purpose: 'privacy_notice',
          version: PRIVACY_POLICY_VERSION,
          channel: 'web_public',
          ipAddress: input.ipAddress?.slice(0, 45) ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          evidence: {
            source: 'presale_checkout',
            orderId: order.id,
            clientRequestId: input.clientRequestId,
            guestEmail: input.guest.email,
            guestName: input.guest.name,
            acceptedPrivacyVersion: input.acceptedPrivacyVersion,
            acceptedTermsVersion: input.acceptedTermsVersion,
          },
        },
      });

      return { ok: true as const, order };
    });

    if (!outcome.ok) return outcome;
    created = outcome.order;
  } catch (err) {
    // Clique duplo: a unique (origin, clientRequestId) faz a segunda chamada
    // bater em P2002. Pedido ainda `pending` devolve a sessão dele; qualquer
    // outro status devolve 409, porque uma sessão morta vira beco sem saída —
    // o cliente refaz com um id novo.
    if (!isUniqueConstraintErrorOn(err, 'clientRequestId')) throw err;

    const existing = await prisma.order.findUnique({
      where: {
        origin_clientRequestId: {
          origin: 'casa_in_box',
          clientRequestId: input.clientRequestId,
        },
      },
    });
    if (!existing) throw err;
    if (existing.status !== 'pending') {
      return fail(
        409,
        'Conflict',
        'PRESALE_REQUEST_STALE',
        'esta tentativa de pagamento já foi encerrada. Tente de novo.',
      );
    }
    // Perdeu a corrida da unique: NÃO é dona da tentativa de pagamento do
    // pedido que encontrou. Ver o cabeçalho de ensureCheckoutSession.
    return ensureCheckoutSession(existing, deps, { ownsStripeAttempt: false });
  }

  return ensureCheckoutSession(created, deps, { ownsStripeAttempt: true });
};
