import { prisma } from '@ccc/db';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isBillingActionError } from '../../src/services/billing/errors.js';
import {
  changePlan,
  pauseCollection,
  resumeCancel,
  resumeCollection,
  scheduleCancel,
} from '../../src/services/billing/subscription-actions.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

// resetDatabase() (test/helpers.ts) does not cover the premium catalog tables —
// same convention as premium-catalog.test.ts and admin/premium-catalog-admin.test.ts,
// which each truncate them locally before seeding.
async function resetCatalog(): Promise<void> {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
}

async function seed() {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_1',
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      currency: 'BRL',
    },
  });

  const gold = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 2 },
  });
  const silver = await prisma.premiumPlan.create({
    data: { tier: 'silver', slug: 'estrada', name: 'Estrada', sortOrder: 1 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: gold.id,
      cadence: 'monthly',
      baseAmountCents: 149000,
      currency: 'BRL',
      stripePriceId: 'price_gold',
    },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: silver.id,
      cadence: 'monthly',
      baseAmountCents: 89000,
      currency: 'BRL',
      stripePriceId: 'price_silver',
    },
  });

  return { membershipId: membership.id };
}

const fakeSubscription = (items: Array<{ id: string; priceId: string }>): Stripe.Subscription =>
  ({
    id: 'sub_1',
    items: { data: items.map((i) => ({ id: i.id, price: { id: i.priceId } })) },
  }) as unknown as Stripe.Subscription;

describe('changePlan', () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });
  afterEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });

  it('troca o preco do item de plano e nao escreve no banco', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextRetrievedSubscription = fakeSubscription([{ id: 'si_plan', priceId: 'price_gold' }]);

    await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

    expect(stripe.calls.at(-1)).toEqual({
      kind: 'updateSubscriptionItemPrice',
      payload: {
        subscriptionItemId: 'si_plan',
        priceId: 'price_silver',
        idempotencyKey: `plan_change_${membershipId}_silver_monthly`,
      },
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.tier).toBe('gold');
    expect(membership.baseAmountCents).toBe(149000);
  });

  it('escolhe o item de plano certo quando ha dois modulos vinculados', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextRetrievedSubscription = fakeSubscription([
      { id: 'si_addon_a', priceId: 'price_detailing' },
      { id: 'si_plan', priceId: 'price_gold' },
      { id: 'si_addon_b', priceId: 'price_oficina' },
    ]);

    await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

    const call = stripe.calls.at(-1) as { payload: { subscriptionItemId: string } };
    expect(call.payload.subscriptionItemId).toBe('si_plan');
  });

  it('trocar para o plano atual lanca NoChange e nao chama a Stripe', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    const err = await changePlan({
      membershipId,
      tier: 'gold',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);

    expect(isBillingActionError(err) && err.code).toBe('NoChange');
    expect(stripe.calls).toEqual([]);
  });

  it('plano alvo sem stripePriceId lanca PlanPriceMissing e nao chama a Stripe', async () => {
    const { membershipId } = await seed();
    const bronze = await prisma.premiumPlan.create({
      data: { tier: 'bronze', slug: 'ingresso', name: 'Ingresso', sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: bronze.id,
        cadence: 'monthly',
        baseAmountCents: 49000,
        currency: 'BRL',
        stripePriceId: null,
      },
    });
    const stripe = buildFakeStripe();

    const err = await changePlan({
      membershipId,
      tier: 'bronze',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);

    expect(isBillingActionError(err) && err.code).toBe('PlanPriceMissing');
    expect(stripe.calls).toEqual([]);
  });

  it('item de plano ambiguo lanca AmbiguousPlanItem e nao troca preco', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextRetrievedSubscription = fakeSubscription([
      { id: 'si_addon', priceId: 'price_detailing' },
    ]);

    const err = await changePlan({
      membershipId,
      tier: 'silver',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);

    expect(isBillingActionError(err) && err.code).toBe('AmbiguousPlanItem');
    expect(stripe.calls.map((c) => c.kind)).not.toContain('updateSubscriptionItemPrice');
  });

  it('assinatura inexistente lanca MembershipNotFound', async () => {
    const stripe = buildFakeStripe();
    const err = await changePlan({
      membershipId: 'mem_x',
      tier: 'silver',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);
    expect(isBillingActionError(err) && err.code).toBe('MembershipNotFound');
  });
});

describe('acoes de status', () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });
  afterEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });

  it('cada acao chama o metodo certo da Stripe com chave de idempotencia', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    await scheduleCancel({ membershipId, stripe });
    await resumeCancel({ membershipId, stripe });
    await pauseCollection({ membershipId, stripe });
    await resumeCollection({ membershipId, stripe });

    expect(stripe.calls).toEqual([
      {
        kind: 'cancelSubscriptionAtPeriodEnd',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_cancel_${membershipId}` },
      },
      {
        kind: 'resumeSubscriptionCancellation',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_resume_cancel_${membershipId}` },
      },
      {
        kind: 'pauseSubscriptionCollection',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_pause_${membershipId}` },
      },
      {
        kind: 'resumeSubscriptionCollection',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_resume_collect_${membershipId}` },
      },
    ]);
  });

  it('nenhuma acao de status escreve no banco', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    const before = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });

    await scheduleCancel({ membershipId, stripe });
    await pauseCollection({ membershipId, stripe });

    const after = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.status).toBe(before.status);
    expect(after.cancelAtPeriodEnd).toBe(before.cancelAtPeriodEnd);
  });
});
