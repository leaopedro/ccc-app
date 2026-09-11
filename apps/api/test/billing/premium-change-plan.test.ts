/**
 * POST /api/me/premium/plan — troca de plano iniciada pelo membro.
 *
 * A rota nao escreve em PremiumMembership: quem grava tier/cadence e o webhook
 * verificado. O teste do caminho feliz prova isso lendo a linha depois do 200.
 *
 * Todo teste de guard afirma `ctx.stripe.calls` VAZIA — a lista inteira, nao so
 * `updateSubscriptionItemPrice`. E o que pega uma reordenacao de guards que
 * passe a chamar `retrieveSubscription` antes de recusar.
 */

import { prisma } from '@ccc/db';
import type { LightMyRequestResponse } from 'fastify';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { seedSubscription } from '../admin/subscriptions/seed.js';
import { bearer, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

type App = Awaited<ReturnType<typeof makeAppWithFakeStripe>>;

// resetDatabase() deliberadamente NAO limpa o catalogo premium (ver
// test/helpers.ts), e seedSubscription() cria plano (tier/slug unique) e modulo
// (key unique) a cada chamada. Sem este reset local o segundo teste colide.
const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const planItemSubscription = {
  id: 'sub_secreto_1',
  items: { data: [{ id: 'si_plan', price: { id: 'price_gold' } }] },
} as unknown as Stripe.Subscription;

/** O catalogo do seed so tem preco mensal. O guard anual precisa de um anual. */
const addSilverAnnualPrice = async (stripePriceId: string | null): Promise<void> => {
  const silver = await prisma.premiumPlan.findUniqueOrThrow({ where: { slug: 'estrada' } });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: silver.id,
      cadence: 'annual',
      baseAmountCents: 890000,
      currency: 'BRL',
      stripePriceId,
    },
  });
};

describe('POST /api/me/premium/plan', () => {
  let ctx: App;

  const change = async (
    memberId: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    await ctx.app.inject({
      method: 'POST',
      url: '/api/me/premium/plan',
      headers: { authorization: bearer(loadEnv(), memberId, 'user') },
      payload,
    });

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    ctx = await makeAppWithFakeStripe();
  });

  afterEach(async () => {
    await ctx.app.close();
    // resetCatalog() nao consegue apagar PremiumAddonModule enquanto um
    // PremiumMembershipAddon o referencia — resetDatabase() roda antes para que
    // a cascata de PremiumMembership limpe essas linhas.
    await resetDatabase();
    await resetCatalog();
  });

  it('401 sem autenticacao', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/premium/plan',
      payload: { planSlug: 'estrada', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(401);
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('troca valida responde pending e NAO escreve a membership', async () => {
    const { memberId, membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pending: true });
    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(row.tier).toBe('gold');
    expect(row.cadence).toBe('monthly');
    expect(ctx.stripe.calls.filter((c) => c.kind === 'updateSubscriptionItemPrice')).toHaveLength(
      1,
    );
  });

  it('grava auditoria com o actorId do membro e actorKind member', async () => {
    const { memberId, membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });
    expect(res.statusCode).toBe(200);

    const audit = await prisma.adminAudit.findMany({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('premium.subscription.plan_changed');
    expect(audit[0]?.actorId).toBe(memberId);
    expect(audit[0]?.metadata).toMatchObject({
      actorKind: 'member',
      fromTier: 'gold',
      fromCadence: 'monthly',
      toTier: 'silver',
      toCadence: 'monthly',
    });
  });

  it('409 InvalidStatus para past_due', async () => {
    const { memberId } = await seedSubscription({ status: 'past_due' });
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'InvalidStatus', status: 'past_due' });
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('permite a troca em cancel_scheduled', async () => {
    const { memberId } = await seedSubscription({ status: 'cancel_scheduled' });
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pending: true });
  });

  it('409 NotStripeSubscription com manageUrl para assinante Apple', async () => {
    const { memberId } = await seedSubscription({ provider: 'apple_revenuecat' });

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NotStripeSubscription' });
    expect((res.json() as { manageUrl?: string }).manageUrl).toContain('apps.apple.com');
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('provider vem antes de status e de slug: Apple past_due com slug inexistente responde NotStripeSubscription', async () => {
    const { memberId } = await seedSubscription({
      provider: 'apple_revenuecat',
      status: 'past_due',
    });

    const res = await change(memberId, { planSlug: 'nao-existe', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NotStripeSubscription' });
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('409 NoChange quando o plano pedido ja e o atual', async () => {
    const { memberId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'fundador', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NoChange' });
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('404 PlanNotFound para slug inexistente', async () => {
    const { memberId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'nao-existe', cadence: 'monthly' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'PlanNotFound' });
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('404 PlanNotFound quando o plano nao tem stripePriceId na cadencia pedida', async () => {
    const { memberId } = await seedSubscription({ withAddon: false });
    await addSilverAnnualPrice(null);
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'annual' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'PlanNotFound' });
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('422 AnnualCadenceAddonUnsupported com modulo anexado', async () => {
    const { memberId } = await seedSubscription();
    await addSilverAnnualPrice('price_silver_annual');
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'annual' });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'PremiumCheckoutRejected',
      code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
      addonKeys: ['detailing'],
    });
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('404 quando nao ha membership viva', async () => {
    const { memberId } = await seedSubscription({ status: 'expired' });

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(404);
    expect(ctx.stripe.calls).toHaveLength(0);
  });

  it('422 para body invalido', async () => {
    const { memberId } = await seedSubscription();

    const res = await change(memberId, { planSlug: '', cadence: 'semanal' });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'UnprocessableEntity' });
    expect(ctx.stripe.calls).toHaveLength(0);
  });
});
