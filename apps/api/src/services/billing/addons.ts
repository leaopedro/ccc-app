import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';

import type { StripeClient } from '../stripe/index.js';

import { BillingActionError } from './errors.js';

/** Add-on statuses que ainda contam como vinculado (cobravel ou em encerramento). */
const ATTACHED_ADDON_STATUSES = ['active', 'cancel_scheduled'] as const;

export type AddonMutationResult = {
  addonKey: string;
  status: 'active' | 'cancel_scheduled' | 'cancelled';
  addonsAmountCents: number;
  totalAmountCents: number;
};

type AddonMutationInput = {
  membershipId: string;
  addonKey: string;
  stripe: StripeClient;
  logger: FastifyBaseLogger;
};

/**
 * Recalcula addonsAmountCents somando SO os add-ons `active`. Um add-on em
 * cancel_scheduled ja nao e cobrado pela Stripe, entao nao pode continuar
 * somando no total local.
 */
async function recomputeAddonsAmount(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  membershipId: string,
): Promise<number> {
  const agg = await tx.premiumMembershipAddon.aggregate({
    where: { membershipId, status: 'active' },
    _sum: { monthlyDeltaCents: true },
  });
  const addonsAmountCents = agg._sum.monthlyDeltaCents ?? 0;
  await tx.premiumMembership.update({
    where: { id: membershipId },
    data: { addonsAmountCents },
  });
  return addonsAmountCents;
}

/**
 * Vincula um modulo a uma assinatura.
 *
 * Ordem provider-first: o SubscriptionItem da Stripe e criado ANTES da
 * transacao. Falha da Stripe lanca aqui e deixa o estado local intocado, sem
 * necessidade de compensacao. O caso raro de orfao (Stripe ok, tx falha depois)
 * e reconciliado pelo sync do webhook de add-ons e pelo worker de reconciliacao.
 *
 * Fallback local-only, sem lancar, quando a assinatura nao tem providerSubRef OU
 * o modulo nao tem stripePriceId configurado.
 *
 * Preco, cota, repasse e fornecedor sao SNAPSHOTADOS no vinculo: editar o
 * catalogo depois nao altera um add-on ja ativo.
 *
 * Nao valida o status da assinatura. Isso e responsabilidade do chamador, porque
 * a lista de status aceitos difere entre a superficie do membro e a do admin.
 */
export const attachAddon = async ({
  membershipId,
  addonKey,
  stripe,
  logger,
}: AddonMutationInput): Promise<AddonMutationResult> => {
  const membership = await prisma.premiumMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new BillingActionError('MembershipNotFound', 'membership not found', { membershipId });
  }

  const addonModule = await prisma.premiumAddonModule.findUnique({ where: { key: addonKey } });
  if (!addonModule || !addonModule.active) {
    throw new BillingActionError('ModuleNotFound', 'add-on module not found', { addonKey });
  }

  const existing = await prisma.premiumMembershipAddon.findUnique({
    where: { membershipId_addonKey: { membershipId, addonKey } },
  });
  if (existing && existing.status !== 'cancelled') {
    throw new BillingActionError('AddonAlreadyAttached', 'add-on already attached', { addonKey });
  }

  const cycleStart = membership.currentPeriodStart ?? new Date();
  const cycleEnd = membership.currentPeriodEnd;

  let providerItemRef: string | null = null;
  const stripeBacked = membership.provider === 'stripe' && Boolean(membership.providerSubRef);
  if (stripeBacked && addonModule.stripePriceId) {
    const item = await stripe.addSubscriptionItem({
      subscriptionId: membership.providerSubRef,
      priceId: addonModule.stripePriceId,
      idempotencyKey: `addon_attach_${membership.id}_${addonKey}`,
    });
    providerItemRef = item.subscriptionItemId;
  } else {
    logger.info(
      {
        membershipId: membership.id,
        addonKey,
        provider: membership.provider,
        hasStripePrice: Boolean(addonModule.stripePriceId),
      },
      'billing/addons: attach local-only (no stripe sub ref or module stripePriceId)',
    );
  }

  const snapshot = {
    providerItemRef,
    monthlyDeltaCents: addonModule.monthlyDeltaCents,
    payoutAmountCents: addonModule.payoutAmountCents,
    vendorName: addonModule.vendorName,
    quotaPerCycle: addonModule.quotaPerCycle,
    quotaUnit: addonModule.quotaUnit,
    currency: addonModule.currency,
  };

  const addonsAmountCents = await prisma.$transaction(async (tx) => {
    if (existing) {
      // Re-vinculo de um add-on antes cancelado: refresca o snapshot para os
      // termos atuais do catalogo e reabre o ciclo de uso deste periodo.
      await tx.premiumMembershipAddon.update({
        where: { id: existing.id },
        data: { status: 'active', ...snapshot },
      });
      await tx.premiumAddonUsage.upsert({
        where: { membershipAddonId_cycleStart: { membershipAddonId: existing.id, cycleStart } },
        create: {
          membershipAddonId: existing.id,
          cycleStart,
          cycleEnd,
          quotaTotal: addonModule.quotaPerCycle,
          quotaUsed: 0,
        },
        update: {},
      });
    } else {
      const created = await tx.premiumMembershipAddon.create({
        data: { membershipId, addonKey, status: 'active', ...snapshot },
      });
      await tx.premiumAddonUsage.create({
        data: {
          membershipAddonId: created.id,
          cycleStart,
          cycleEnd,
          quotaTotal: addonModule.quotaPerCycle,
          quotaUsed: 0,
        },
      });
    }

    return recomputeAddonsAmount(tx, membershipId);
  });

  return {
    addonKey,
    status: 'active',
    addonsAmountCents,
    totalAmountCents: membership.baseAmountCents + addonsAmountCents,
  };
};

/**
 * Desvincula um modulo.
 *
 * Ordem provider-first, espelhando o attach. O item da Stripe e removido de
 * imediato, com rateio; a linha local vira `cancel_scheduled` para o membro
 * manter a cota ate o fim do periodo enquanto a Stripe para de cobrar. Isso e
 * uma simplificacao deliberada, herdada do fluxo do membro.
 *
 * Nunca faz hard delete: o historico de uso e preservado.
 */
export const detachAddon = async ({
  membershipId,
  addonKey,
  stripe,
  logger,
}: AddonMutationInput): Promise<AddonMutationResult> => {
  const membership = await prisma.premiumMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new BillingActionError('MembershipNotFound', 'membership not found', { membershipId });
  }

  const addon = await prisma.premiumMembershipAddon.findUnique({
    where: { membershipId_addonKey: { membershipId, addonKey } },
  });
  if (!addon || !(ATTACHED_ADDON_STATUSES as readonly string[]).includes(addon.status)) {
    throw new BillingActionError('AddonNotAttached', 'add-on not attached', { addonKey });
  }

  if (membership.provider === 'stripe' && addon.providerItemRef) {
    await stripe.removeSubscriptionItem({
      subscriptionItemId: addon.providerItemRef,
      idempotencyKey: `addon_detach_${addon.id}`,
    });
  } else {
    logger.info(
      { membershipId, addonKey, provider: membership.provider },
      'billing/addons: detach local-only (no provider item ref)',
    );
  }

  const addonsAmountCents = await prisma.$transaction(async (tx) => {
    await tx.premiumMembershipAddon.update({
      where: { id: addon.id },
      data: { status: 'cancel_scheduled' },
    });
    return recomputeAddonsAmount(tx, membershipId);
  });

  return {
    addonKey,
    status: 'cancel_scheduled',
    addonsAmountCents,
    totalAmountCents: membership.baseAmountCents + addonsAmountCents,
  };
};
