import { prisma } from '@ccc/db';

import { createUser } from '../../helpers.js';

export const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
export const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

export async function seedSubscription(
  options: {
    provider?: 'stripe' | 'apple_revenuecat';
    status?: 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
    withAddon?: boolean;
  } = {},
) {
  const { provider = 'stripe', status = 'active', withAddon = true } = options;

  const { user: member } = await createUser({
    email: 'membro@example.com',
    name: 'Ana',
    verified: true,
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: member.id } });

  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 2 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 149000,
      currency: 'BRL',
      stripePriceId: 'price_gold',
    },
  });
  // Segundo plano no catalogo: a mutacao de troca de plano precisa de um
  // destino real para migrar para. Membership continua no gold; so o catalogo
  // ganha o silver. Espelha o seed de test/billing/subscription-actions.test.ts.
  const silverPlan = await prisma.premiumPlan.create({
    data: { tier: 'silver', slug: 'estrada', name: 'Estrada', sortOrder: 1 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: silverPlan.id,
      cadence: 'monthly',
      baseAmountCents: 89000,
      currency: 'BRL',
      stripePriceId: 'price_silver',
    },
  });
  await prisma.premiumAddonModule.create({
    data: {
      key: 'detailing',
      name: 'Detailing',
      description: '3 acessos',
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      vendorName: 'Lava Rápido X',
      quotaPerCycle: 3,
      quotaUnit: 'access',
      currency: 'BRL',
      stripePriceId: 'price_detailing',
    },
  });

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider,
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_secreto_1',
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      addonsAmountCents: withAddon ? 15000 : 0,
      currency: 'BRL',
      paymentBrand: 'visa',
      paymentLast4: '4242',
    },
  });

  if (withAddon) {
    const addon = await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: 'detailing',
        status: 'active',
        providerItemRef: 'si_secreto_1',
        monthlyDeltaCents: 15000,
        payoutAmountCents: 9000,
        vendorName: 'Lava Rápido X',
        quotaPerCycle: 3,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });
    await prisma.premiumAddonUsage.create({
      data: {
        membershipAddonId: addon.id,
        cycleStart: PERIOD_START,
        cycleEnd: PERIOD_END,
        quotaTotal: 3,
        quotaUsed: 1,
      },
    });
  }

  await prisma.premiumMembershipInvoice.create({
    data: {
      membershipId: membership.id,
      provider,
      providerInvoiceRef: 'in_1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 164000,
      addonsAmountCents: withAddon ? 15000 : 0,
      currency: 'BRL',
      paidAt: PERIOD_START,
      status: 'paid',
    },
  });

  return { membershipId: membership.id, memberId: member.id, garageId: garage.id };
}
