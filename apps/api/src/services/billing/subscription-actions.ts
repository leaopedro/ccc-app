import { prisma } from '@ccc/db';
import type { GaragePremiumTier, PremiumCadence, PremiumMembership } from '@prisma/client';

import type { StripeClient } from '../stripe/index.js';

import { BillingActionError } from './errors.js';
import { resolvePlanSubscriptionItemId } from './plan-item.js';

/**
 * Acoes de assinatura iniciadas pelo admin.
 *
 * INVARIANTE: nenhuma funcao deste arquivo escreve em PremiumMembership. Elas so
 * chamam a Stripe. Quem grava status, tier e valores e o webhook verificado, via
 * applyMembershipEvent. Por isso as respostas dessas acoes sao marcadas como
 * pending na camada HTTP.
 *
 * Nenhuma funcao daqui valida status nem provider. Isso e responsabilidade da
 * rota, porque a lista de status aceitos difere por acao.
 */

async function loadMembership(membershipId: string): Promise<PremiumMembership> {
  const membership = await prisma.premiumMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new BillingActionError('MembershipNotFound', 'membership not found', { membershipId });
  }
  return membership;
}

/**
 * Troca o plano da assinatura.
 *
 * Rateio em create_prorations, via updateSubscriptionItemPrice: a diferenca
 * proporcional entra como credito ou debito na fatura seguinte, nunca como
 * cobranca imediata fora do ciclo.
 */
export const changePlan = async ({
  membershipId,
  tier,
  cadence,
  stripe,
}: {
  membershipId: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);

  if (membership.tier === tier && membership.cadence === cadence) {
    throw new BillingActionError('NoChange', 'subscription already on this plan and cadence', {
      tier,
      cadence,
    });
  }

  const targetPlan = await prisma.premiumPlan.findUnique({
    where: { tier },
    include: { prices: { where: { cadence } } },
  });
  const targetPriceId = targetPlan?.prices[0]?.stripePriceId ?? null;
  if (!targetPriceId) {
    throw new BillingActionError(
      'PlanPriceMissing',
      'target plan has no stripePriceId configured for this cadence',
      { tier, cadence },
    );
  }

  // Conjunto de TODOS os precos de plano do catalogo. Ler contra o catalogo e o
  // que permite distinguir o item de plano de um item de add-on.
  const allPlanPrices = await prisma.premiumPlanPrice.findMany({
    where: { stripePriceId: { not: null } },
    select: { stripePriceId: true },
  });
  const planPriceIds = new Set(
    allPlanPrices.map((p) => p.stripePriceId).filter((id): id is string => id !== null),
  );

  const subscription = await stripe.retrieveSubscription(membership.providerSubRef);
  const planItemId = resolvePlanSubscriptionItemId({ subscription, planPriceIds });

  await stripe.updateSubscriptionItemPrice({
    subscriptionItemId: planItemId,
    priceId: targetPriceId,
    idempotencyKey: `plan_change_${membershipId}_${tier}_${cadence}`,
  });
};

/** Agenda o cancelamento para o fim do periodo pago. Entitlement segue vivo. */
export const scheduleCancel = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.cancelSubscriptionAtPeriodEnd({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_cancel_${membershipId}`,
  });
};

/** Desfaz um cancelamento agendado. */
export const resumeCancel = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.resumeSubscriptionCancellation({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_resume_cancel_${membershipId}`,
  });
};

/** Suspende a cobranca sem cancelar. */
export const pauseCollection = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.pauseSubscriptionCollection({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_pause_${membershipId}`,
  });
};

/** Retoma a cobranca de uma assinatura pausada. */
export const resumeCollection = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.resumeSubscriptionCollection({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_resume_collect_${membershipId}`,
  });
};
