import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';
import { createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

async function garageFor() {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return garage.id;
}

const activatedEvent = (
  garageId: string,
  payment: { paymentBrand?: string; paymentLast4?: string },
): BillingEvent => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_1',
  providerSubRef: 'sub_1',
  garageId,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: PERIOD_START,
  currentPeriodEnd: PERIOD_END,
  pricing: {
    baseAmountCents: 149000,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents: 149000,
    currency: 'BRL',
    ...payment,
  },
  invoice: {
    providerInvoiceRef: 'in_1',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    paidAt: PERIOD_START,
  },
  lines: [],
  addons: [],
  addonsAmountCents: 0,
});

const renewedEvent = (payment: { paymentBrand?: string; paymentLast4?: string }): BillingEvent => ({
  kind: 'subscription.renewed',
  provider: 'stripe',
  providerSubRef: 'sub_1',
  currentPeriodStart: PERIOD_END,
  currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
  pricing: {
    baseAmountCents: 149000,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents: 149000,
    currency: 'BRL',
    ...payment,
  },
  invoice: {
    providerInvoiceRef: 'in_2',
    periodStart: PERIOD_END,
    periodEnd: new Date('2026-10-01T00:00:00.000Z'),
    paidAt: PERIOD_END,
  },
  lines: [],
});

async function apply(garageId: string, evt: BillingEvent) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });
}

describe('snapshot de metodo de pagamento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('grava bandeira e final na ativacao', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, { paymentBrand: 'visa', paymentLast4: '4242' }));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBe('visa');
    expect(membership.paymentLast4).toBe('4242');
  });

  it('ativacao sem o dado deixa as colunas nulas', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, {}));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBeNull();
    expect(membership.paymentLast4).toBeNull();
  });

  it('renovacao sem o dado NAO apaga o snapshot da ativacao', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, { paymentBrand: 'visa', paymentLast4: '4242' }));
    await apply(garageId, renewedEvent({}));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBe('visa');
    expect(membership.paymentLast4).toBe('4242');
  });

  it('renovacao com dado novo substitui o antigo', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, { paymentBrand: 'visa', paymentLast4: '4242' }));
    await apply(garageId, renewedEvent({ paymentBrand: 'mastercard', paymentLast4: '1111' }));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBe('mastercard');
    expect(membership.paymentLast4).toBe('1111');
  });
});

// ---------------------------------------------------------------------------
// Webhook-level: resolucao do metodo de pagamento via PaymentIntent
//
// Fixture propria: invoice.paid da stripe-billing-webhook.test.ts nao tem
// payment_intent, e este e um caso diferente, nao uma reutilizacao daquele
// mesmo fixture. So os campos que a rota realmente le, mais payment_intent.
// ---------------------------------------------------------------------------

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const invoicePaidWithPaymentIntent = (eventId: string): WebhookEvent => ({
  id: eventId,
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_pm_1',
      subscription: 'sub_pm_1',
      customer: 'cus_pm_1',
      billing_reason: 'subscription_create',
      amount_paid: 149000,
      currency: 'brl',
      period_start: 1767225600,
      period_end: 1769904000,
      payment_intent: 'pi_1',
      lines: {
        data: [
          {
            price: { id: 'price_pm_test', metadata: {}, recurring: { interval: 'month' } },
            amount: 149000,
            subscription_item: 'si_pm_1',
          },
        ],
      },
    },
  },
});

describe('webhook de billing: resolucao do metodo de pagamento', () => {
  let app: FastifyInstance | undefined;
  const originalSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;

  beforeEach(async () => {
    await resetDatabase();
    // resetDatabase() nao limpa o catalogo de planos/precos (mesma observacao
    // ja registrada em stripe-billing-webhook.test.ts) — precisa limpar aqui
    // tambem, ou o segundo teste bate no unique de tier.
    await prisma.premiumAddonModule.deleteMany();
    await prisma.premiumPlanPrice.deleteMany();
    await prisma.premiumPlan.deleteMany();
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test_billing_webhook_secret_32chars';
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (originalSecret === undefined) {
      delete process.env.STRIPE_BILLING_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_BILLING_WEBHOOK_SECRET = originalSecret;
    }
  });

  const seedCatalog = async () => {
    const plan = await prisma.premiumPlan.create({
      data: { tier: 'gold', slug: 'fundador-pm', name: 'Fundador', active: true, sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: plan.id,
        cadence: 'monthly',
        baseAmountCents: 149000,
        currency: 'BRL',
        stripePriceId: 'price_pm_test',
        active: true,
      },
    });
  };

  it('resolve o cartao via PaymentIntent e grava o snapshot', async () => {
    const built = await makeAppWithFakeStripe();
    app = built.app;
    const stripe = built.stripe;
    await seedCatalog();
    const { user } = await createUser({ email: 'pm-resolve@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_pm_1', { garageId: garage.id });
    stripe.nextPaymentMethodCard = { brand: 'visa', last4: '4242' };

    const evt = invoicePaidWithPaymentIntent('evt_pm_resolve_1');
    stripe.nextEvent = evt;

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(evt),
    });

    expect(res.statusCode).toBe(200);
    expect(
      stripe.calls.some(
        (c) =>
          c.kind === 'retrievePaymentMethodCard' &&
          (c.payload as { paymentIntentId: string }).paymentIntentId === 'pi_1',
      ),
    ).toBe(true);

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_pm_1' } },
    });
    expect(membership.paymentBrand).toBe('visa');
    expect(membership.paymentLast4).toBe('4242');
  });

  it('falha ao resolver o cartao nao derruba o webhook', async () => {
    const built = await makeAppWithFakeStripe();
    app = built.app;
    const stripe = built.stripe;
    await seedCatalog();
    const { user } = await createUser({ email: 'pm-fail@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_pm_1', { garageId: garage.id });
    stripe.nextRetrievePaymentMethodCardError = new Error('stripe down');

    const evt = invoicePaidWithPaymentIntent('evt_pm_fail_1');
    stripe.nextEvent = evt;

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      payload: rawJson(evt),
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_pm_1' } },
    });
    expect(membership.paymentBrand).toBeNull();
    expect(membership.paymentLast4).toBeNull();
  });
});
