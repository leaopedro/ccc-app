import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay, type FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

// Copiado de box-checkout.test.ts de proposito: os dois arquivos evoluem por
// motivos diferentes e o teste do Pix nao deve virar dependencia deste.
const seed = async (opts: { cutoffAt: Date; chargeCents: number }) => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: opts.chargeCents,
      baseAmountCents: opts.chargeCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      status: 'pending',
      shippingCents: 0,
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: opts.cutoffAt,
      budgetCentsSnapshot: 10000,
      status: 'awaiting_payment',
      orderId: order.id,
      chargeCents: opts.chargeCents,
    },
  });
  return { user, order, box };
};

const future = new Date(Date.now() + 3 * 24 * 3600_000);

const piCalls = (stripe: FakeStripe) =>
  stripe.calls.filter((c) => c.kind === 'createPaymentIntent');
const pixCalls = (abacatepay: FakeAbacatePay) =>
  abacatepay.calls.filter((c) => c.method === 'createPixBilling');

describe('POST /me/box/checkout com method=card', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let abacatepay: FakeAbacatePay;

  const boot = async (opts?: { withAbacatePay?: boolean }) => {
    stripe = buildFakeStripe();
    abacatepay = buildFakeAbacatePay();
    app = await buildApp(loadEnv(), {
      stripe,
      ...(opts?.withAbacatePay === false ? {} : { abacatepay }),
    });
  };

  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true },
      create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, shippingFeeCents: 0 },
    });
    await boot();
  });

  afterEach(async () => {
    await app.close();
  });

  const checkout = (userId: string, payload?: { method: string }) =>
    app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, userId) },
      ...(payload ? { payload } : {}),
    });

  it('cria um PaymentIntent e carimba method/provider/providerRef', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    stripe.nextPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' };

    const res = await checkout(user.id, { method: 'card' });

    expect(res.statusCode).toBe(200);
    expect(res.json().method).toBe('card');
    expect(res.json().clientSecret).toBe('pi_box_1_secret');
    expect(res.json().amountCents).toBe(2000);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.method).toBe('card');
    expect(fresh.provider).toBe('stripe');
    expect(fresh.providerRef).toBe('pi_box_1');
    expect(fresh.brCode).toBeNull();

    expect(pixCalls(abacatepay)).toHaveLength(0);
    const created = piCalls(stripe);
    expect(created).toHaveLength(1);
    const payload = created[0]!.payload as {
      metadata: Record<string, string>;
      paymentMethodTypes?: string[];
    };
    expect(payload.metadata.orderId).toBe(order.id);
    // Prazo duro: um metodo assincrono liquidaria depois do cutoff.
    expect(payload.paymentMethodTypes).toEqual(['card']);
  });

  it('reusa o PaymentIntent na segunda chamada', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });
    stripe.nextPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' };

    const first = await checkout(user.id, { method: 'card' });
    stripe.nextRetrievedPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' };
    const second = await checkout(user.id, { method: 'card' });

    expect(second.statusCode).toBe(200);
    expect(second.json().clientSecret).toBe(first.json().clientSecret);
    expect(piCalls(stripe)).toHaveLength(1);
    expect(stripe.calls.filter((c) => c.kind === 'retrievePaymentIntent')).toHaveLength(1);
  });

  it('trava o metodo: pedir pix depois do cartao devolve o cartao', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });
    stripe.nextPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' };
    await checkout(user.id, { method: 'card' });

    stripe.nextRetrievedPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' };
    const res = await checkout(user.id, { method: 'pix' });

    expect(res.json().method).toBe('card');
    // A trava existe porque a AbacatePay nao cancela: duas cobrancas vivas na
    // mesma Order e o pior resultado possivel.
    expect(pixCalls(abacatepay)).toHaveLength(0);
  });

  it('trava o metodo ao contrario: pedir cartao depois do pix devolve o pix', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBilling = {
      id: 'pix_char_1',
      brCode: '00020126-BR',
      amount: 2000,
      expiresAt: future.toISOString(),
      status: 'PENDING',
    };
    await checkout(user.id, { method: 'pix' });

    const res = await checkout(user.id, { method: 'card' });

    expect(res.json().method).toBe('pix');
    expect(res.json().brCode).toBe('00020126-BR');
    expect(piCalls(stripe)).toHaveLength(0);
  });

  // Buraco herdado do codigo antigo, cuja guarda era `providerRef && brCode`:
  // a linha caia no `create`, criava cobranca real, falhava no carimbo e
  // devolvia box_locked. Cada retry gerava outra orfa, 5 por minuto.
  it('nunca recria cobranca numa linha com providerRef e brCode nulo', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    await prisma.order.update({
      where: { id: order.id },
      data: { providerRef: 'pix_char_1', brCode: null },
    });

    const res = await checkout(user.id, { method: 'pix' });

    expect(res.statusCode).toBe(502);
    expect(pixCalls(abacatepay)).toHaveLength(0);
    expect(piCalls(stripe)).toHaveLength(0);
  });

  it('422 num metodo desconhecido, snake_case e sem issues do zod', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });

    const res = await checkout(user.id, { method: 'boleto' });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid_payment_method');
    expect(res.json().issues).toBeUndefined();
  });

  it('sem corpo, continua caindo no pix (build antigo do app)', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBilling = {
      id: 'pix_char_1',
      brCode: '00020126-BR',
      amount: 2000,
      expiresAt: future.toISOString(),
      status: 'PENDING',
    };

    const res = await checkout(user.id);

    expect(res.statusCode).toBe(200);
    expect(res.json().method).toBe('pix');
    expect(res.json().brCode).toBe('00020126-BR');
  });

  it('409 box_locked no cartao quando ja passou do cutoff', async () => {
    const { user } = await seed({ cutoffAt: new Date(Date.now() - 1000), chargeCents: 2000 });

    const res = await checkout(user.id, { method: 'card' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_locked');
    expect(piCalls(stripe)).toHaveLength(0);
  });

  it('502 quando a Stripe falha, sem carimbar nada', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    stripe.nextPaymentIntentError = new Error('stripe down');

    const res = await checkout(user.id, { method: 'card' });

    expect(res.statusCode).toBe(502);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.providerRef).toBeNull();
    // `provider` e o campo que a Fase C escreveria; assertar so `method` seria
    // vazio, porque o seed ja nasce 'pix'.
    expect(fresh.provider).toBe('abacatepay');
  });

  it('503 quando pedem pix sem abacatepay configurado', async () => {
    await app.close();
    await boot({ withAbacatePay: false });
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });

    const res = await checkout(user.id, { method: 'pix' });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('payment_unavailable');
  });

  it('reuso de cartao funciona mesmo sem abacatepay configurado', async () => {
    await app.close();
    await boot({ withAbacatePay: false });
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    await prisma.order.update({
      where: { id: order.id },
      data: { method: 'card', provider: 'stripe', providerRef: 'pi_box_1' },
    });
    stripe.nextRetrievedPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' };

    const res = await checkout(user.id, { method: 'card' });

    expect(res.statusCode).toBe(200);
    expect(res.json().clientSecret).toBe('pi_box_1_secret');
  });
});
