/**
 * Task 9 — POST /api/me/premium/checkout-native
 *
 * Creates a Stripe Subscription with payment_behavior: 'default_incomplete'
 * and hands the app a client secret for PaymentSheet to confirm. Activation
 * still only happens from the invoice.paid webhook (a separate task) — this
 * route MUST NEVER write a PremiumMembership row.
 *
 * The duplicate guard has five pieces, all exercised below:
 *   1. SELECT ... FOR UPDATE on Garage before any subscriptions.create.
 *   2. PremiumSubscriptionAttempt with a partial unique index on
 *      (garageId) WHERE status = 'pending'.
 *   3. Deterministic idempotency key sub_{garageId}_{cadence}_{digest}_{attemptId}.
 *   4. Terminal status flip on the outcomes this task can observe (abandoned).
 *   5. (Task 10, fix round 1) listOpenSubscriptionCheckoutSessions after the
 *      transaction, refusing rather than minting when a hosted Checkout
 *      Session is already open for this garage — the mirror-direction guard
 *      of Task 10's hosted-side fix.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const seedGoldMonthly = async () => {
  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 1, active: true },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 24_990,
      currency: 'BRL',
      stripePriceId: 'price_gold_monthly',
    },
  });
};

const originalIos = process.env.PREMIUM_SUBSCRIPTIONS_IOS;
const restoreIos = () => {
  if (originalIos === undefined) delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
  else process.env.PREMIUM_SUBSCRIPTIONS_IOS = originalIos;
};

describe('POST /api/me/premium/checkout-native', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    ({ app, stripe } = await makeAppWithFakeStripe());
    await seedGoldMonthly();
  });

  afterEach(async () => {
    await app.close();
  });

  it('devolve clientSecret e grava a tentativa como pending', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { clientSecret: string; subscriptionId: string; attemptId: string };
    expect(body.clientSecret).toBe('pi_sub_secret_fake');

    const attempt = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: body.attemptId },
    });
    expect(attempt.status).toBe('pending');
    expect(attempt.providerSubRef).toBe(body.subscriptionId);

    // Ativacao so acontece pelo webhook invoice.paid (outra task). Esta rota
    // NUNCA pode ter criado uma PremiumMembership.
    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  it('usa a chave determinstica sub_{garageId}_{cadence}_{digest}_{attemptId}', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    const body = res.json() as { attemptId: string };

    const call = stripe.calls.find((c) => c.kind === 'createNativeSubscription');
    const payload = call!.payload as { idempotencyKey: string };
    expect(payload.idempotencyKey.startsWith(`sub_${garage.id}_monthly_`)).toBe(true);
    expect(payload.idempotencyKey.endsWith(`_${body.attemptId}`)).toBe(true);
  });

  // A guarda. Dois toques concorrentes tem que colapsar numa assinatura so.
  it('dois toques seguidos reusam a mesma tentativa e nao abrem segunda assinatura', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    const first = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(second.statusCode).toBe(201);
    expect((second.json() as { attemptId: string }).attemptId).toBe(
      (first.json() as { attemptId: string }).attemptId,
    );
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(1);
  });

  // O ponto central da task: duas requisicoes DE VERDADE concorrentes (nao
  // sequenciais) tem que colapsar no lock FOR UPDATE em uma unica tentativa
  // pending e um unico par de chamadas identicas a Stripe pela mesma chave.
  it('duas chamadas concorrentes de verdade produzem uma unica tentativa', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/me/premium/checkout-native',
        headers: { authorization: token, 'x-ccc-platform': 'ios' },
        payload: { cadence: 'monthly', planSlug: 'fundador' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/me/premium/checkout-native',
        headers: { authorization: token, 'x-ccc-platform': 'ios' },
        payload: { cadence: 'monthly', planSlug: 'fundador' },
      }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const firstAttemptId = (first.json() as { attemptId: string }).attemptId;
    const secondAttemptId = (second.json() as { attemptId: string }).attemptId;
    expect(secondAttemptId).toBe(firstAttemptId);

    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(1);

    const nativeCalls = stripe.calls.filter((c) => c.kind === 'createNativeSubscription');
    expect(nativeCalls).toHaveLength(2);
    const keys = nativeCalls.map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    // Ambas as chamadas usam a MESMA chave (mesmo attempt.id) — e a Stripe,
    // nao este handler, quem colapsaria as duas numa unica assinatura real.
    expect(keys[0]).toBe(keys[1]);

    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  // O caso que a chave puramente deterministica erra: cancelar e reassinar o
  // MESMO pacote dentro de 24h tem que abrir tentativa e assinatura novas, nao
  // devolver o PaymentIntent ja consumido da assinatura cancelada.
  it('cancelar e reassinar o mesmo pacote abre tentativa e assinatura novas', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const first = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { attemptId: string; subscriptionId: string };

    // Simula o desfecho "cancelado dentro de 24h": a tentativa anterior sai de
    // 'pending' (o worker de reconciliacao/webhook de uma task futura faria
    // isso; aqui simulamos o estado resultante diretamente).
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: firstBody.attemptId },
      data: { status: 'abandoned' },
    });

    stripe.nextNativeSubscription = {
      subscriptionId: 'sub_native_fake_2',
      clientSecret: 'pi_sub_secret_fake_2',
      status: 'incomplete',
    };

    const second = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as { attemptId: string; subscriptionId: string };

    expect(secondBody.attemptId).not.toBe(firstBody.attemptId);
    expect(secondBody.subscriptionId).toBe('sub_native_fake_2');
    expect(secondBody.subscriptionId).not.toBe(firstBody.subscriptionId);

    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(2);

    const nativeCalls = stripe.calls.filter((c) => c.kind === 'createNativeSubscription');
    expect(nativeCalls).toHaveLength(2);
    const keys = nativeCalls.map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
    // Mesmo prefixo garageId/cadence/digest — so o attemptId no fim muda.
    expect(keys[0]?.startsWith(`sub_${garage.id}_monthly_`)).toBe(true);
    expect(keys[1]?.startsWith(`sub_${garage.id}_monthly_`)).toBe(true);

    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  // Fix round 1, finding 1 (CRITICAL): trocar de pacote enquanto a tentativa
  // anterior ainda esta pending (invoice.paid nao chegou) NAO pode reusar
  // aquela tentativa — reusar mintaria uma SEGUNDA assinatura viva com uma
  // chave nova (digest diferente), deixando A e B cobrando ao mesmo tempo.
  it('trocar de pacote com uma tentativa pending recusa em vez de abrir segunda assinatura', async () => {
    const plan = await prisma.premiumPlan.findUniqueOrThrow({ where: { slug: 'fundador' } });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: plan.id,
        cadence: 'annual',
        baseAmountCents: 249_900,
        currency: 'BRL',
        stripePriceId: 'price_gold_annual',
      },
    });
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    const first = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { attemptId: string; subscriptionId: string };

    // invoice.paid ainda nao chegou: a tentativa da primeira escolha continua
    // pending quando o usuario tenta um pacote diferente.
    const second = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'annual', planSlug: 'fundador' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'SubscriptionAttemptInFlight' });

    // Nenhuma segunda chamada a Stripe, nenhuma segunda tentativa.
    const nativeCalls = stripe.calls.filter((c) => c.kind === 'createNativeSubscription');
    expect(nativeCalls).toHaveLength(1);
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(1);

    const attempt = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: firstBody.attemptId },
    });
    expect(attempt.status).toBe('pending');
    expect(attempt.providerSubRef).toBe(firstBody.subscriptionId);
    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  // Fix round 1, finding 2 (Important): a chamada perdedora de duas
  // concorrentes com a MESMA chave recebe um idempotency_error da Stripe
  // enquanto a vencedora ainda esta em voo — isso NAO prova que a assinatura
  // nao foi criada. Marcar a tentativa como abandoned aqui destruiria o
  // rastro de uma assinatura que pode estar viva e cobrando.
  it('idempotency_error da chamada perdedora nao marca a tentativa como abandoned', async () => {
    const { user } = await createUser({ verified: true });
    stripe.nextCreateNativeSubscriptionError = new Stripe.errors.StripeIdempotencyError();

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(503);
    const attempt = await prisma.premiumSubscriptionAttempt.findFirstOrThrow();
    expect(attempt.status).toBe('pending');
  });

  // Mesma logica para timeout/erro de conexao: a requisicao pode ter
  // chegado na Stripe e criado a assinatura antes da resposta se perder.
  it('erro de conexao/timeout tambem nao marca a tentativa como abandoned', async () => {
    const { user } = await createUser({ verified: true });
    stripe.nextCreateNativeSubscriptionError = new Stripe.errors.StripeConnectionError();

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(503);
    const attempt = await prisma.premiumSubscriptionAttempt.findFirstOrThrow();
    expect(attempt.status).toBe('pending');
  });

  // Regressao: uma recusa que PROVA que nada foi criado do lado da Stripe
  // ainda deve marcar a tentativa como abandoned, exatamente como antes.
  it('uma recusa definitiva da Stripe marca a tentativa como abandoned', async () => {
    const { user } = await createUser({ verified: true });
    stripe.nextCreateNativeSubscriptionError = new Stripe.errors.StripeInvalidRequestError();

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(503);
    const attempt = await prisma.premiumSubscriptionAttempt.findFirstOrThrow();
    expect(attempt.status).toBe('abandoned');
  });

  it('recusa quando ja existe membership viva', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_x',
        providerSubRef: 'sub_x',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        baseAmountCents: 24_990,
        devFeePercent: 10,
        devFeeAmountCents: 2499,
        grossAmountCents: 27_489,
        currency: 'BRL',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(409);
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(0);
  });

  // Task 10, fix round 1 — espelho do guard cross-path: um checkout hospedado
  // ja aberto (Checkout Session, sem membership, sem PremiumSubscriptionAttempt
  // nenhuma) tem que ser visivel para o caminho nativo, ou o caminho nativo
  // mintaria uma SEGUNDA assinatura viva por cima do checkout hospedado em
  // andamento.
  it('recusa quando ja existe uma Checkout Session hospedada aberta, sem chamar a Stripe', async () => {
    const { user } = await createUser({ verified: true });
    stripe.nextOpenSubscriptionCheckoutSessions = [
      { id: 'cs_hosted_in_flight', url: 'https://checkout.stripe.com/pay/cs_hosted_in_flight' },
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SubscriptionAttemptInFlight' });

    // O ponto central do teste: a Stripe nunca foi chamada para criar a
    // assinatura nativa. Checar so o status code deixaria passar uma
    // implementacao que minta a assinatura e SO DEPOIS recusa a resposta.
    const nativeCalls = stripe.calls.filter((c) => c.kind === 'createNativeSubscription');
    expect(nativeCalls).toHaveLength(0);

    // A tentativa criada por esta mesma requisicao (outcome 'created', nao
    // 'reuse' — era a primeira tentativa nativa desta garagem) e marcada
    // abandoned, nao deixada pending: um 'pending' orfao aqui bloquearia
    // permanentemente o precheck/checkout hospedado (guard do Task 10).
    const attempt = await prisma.premiumSubscriptionAttempt.findFirstOrThrow({
      where: {
        garageId: (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id,
      },
    });
    expect(attempt.status).toBe('abandoned');
    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  // Fix round 2 — o bare await de listOpenSubscriptionCheckoutSessions nao
  // tinha try/catch. Uma falha de rede ali (antes de sabermos se ha ou nao
  // um checkout hospedado aberto) nunca chegava no createNativeSubscription
  // (correto, falha fechado), mas TAMBEM nunca chegava no update que marca
  // abandoned — a linha 'pending' que a transacao ja tinha commitado ficava
  // orfa, e o unique parcial por garageId WHERE status='pending' bloquearia
  // essa garagem ate o reaper de 23h por causa de uma falha que nem provou
  // duplicidade nenhuma.
  it('recusa e limpa a tentativa quando a consulta de Checkout Sessions falha (nao deixa pending orfa)', async () => {
    const { user } = await createUser({ verified: true });
    stripe.nextListOpenSubscriptionCheckoutSessionsError = new Error('stripe timeout');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(503);

    const nativeCalls = stripe.calls.filter((c) => c.kind === 'createNativeSubscription');
    expect(nativeCalls).toHaveLength(0);

    // O ponto central do fix: a linha NAO fica pending. Sem esta asserção o
    // teste provaria so o fail-closed (que ja funcionava), nao a limpeza.
    const attempt = await prisma.premiumSubscriptionAttempt.findFirstOrThrow({
      where: {
        garageId: (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id,
      },
    });
    expect(attempt.status).toBe('abandoned');
    expect(await prisma.premiumMembership.count()).toBe(0);
  });

  it('herda a rejeicao de anual mais add-on da Decisao 2', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.premiumAddonModule.create({
      data: {
        key: 'detail',
        name: 'Detailing',
        description: 'Lavagem mensal',
        monthlyDeltaCents: 9900,
        currency: 'BRL',
        quotaPerCycle: 1,
        quotaUnit: 'access',
        active: true,
        stripePriceId: 'price_addon_detail',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'annual', planSlug: 'fundador', addonKeys: ['detail'] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED' });
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(0);
    const nativeCalls = stripe.calls.filter((c) => c.kind === 'createNativeSubscription');
    expect(nativeCalls).toHaveLength(0);
  });

  it('devolve 429 depois de 5 chamadas do mesmo usuario em um minuto', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/me/premium/checkout-native',
        headers: { authorization: token, 'x-ccc-platform': 'ios' },
        payload: { cadence: 'monthly', planSlug: 'fundador' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    expect(res.statusCode).toBe(429);
  });
});

describe('POST /api/me/premium/checkout-native — platform gate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
  });

  afterEach(async () => {
    await app?.close();
    restoreIos();
  });

  it('recusa com 403 numa plataforma com subscriptions desligadas', async () => {
    ({ app } = await makeAppWithFakeStripe());
    await seedGoldMonthly();
    const localEnv = loadEnv();
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(localEnv, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'PlatformNotSupported' });
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(0);
  });
});
