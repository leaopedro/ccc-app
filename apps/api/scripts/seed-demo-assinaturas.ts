/**
 * Seed de dados de demonstracao para a aba Assinaturas do admin.
 *
 * Cria um membro gold com 6 meses de historico pago e os dois modulos adicionais
 * vinculados, mais quatro assinaturas de contraste. Os contrastes existem porque
 * um filtro nao demonstra nada com uma unica linha: eles cobrem os quatro status
 * que a lista filtra, os tres tiers, as duas cadencias, os dois providers, e um
 * caso apple_revenuecat que exercita o mutable=false na tela de detalhe.
 *
 * Idempotente: apaga tudo que criou antes (por prefixo de email) e recria.
 *
 * NAO usar em producao. Roda so contra o banco apontado por DATABASE_URL.
 *
 *   pnpm --filter @ccc/api exec tsx scripts/seed-demo-assinaturas.ts
 */

import { prisma } from '@ccc/db';
import type {
  GaragePremiumTier,
  PremiumCadence,
  PremiumMembershipStatus,
  PremiumProvider,
} from '@prisma/client';

import { hashPassword } from '../src/services/auth/password.js';

const EMAIL_PREFIX = 'demo.assinatura';
const PASSWORD = 'demo-assinatura-2026';

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

const BASE_BY_TIER: Record<GaragePremiumTier, number> = {
  bronze: 49_000,
  silver: 89_000,
  gold: 149_000,
};

/**
 * Repasse e fornecedor dos modulos. O seed principal deixa payoutAmountCents em 0
 * e vendorName null de proposito, para nao inventar dado financeiro. Aqui inventamos
 * porque o objetivo e justamente ver margem diferente de zero na tela.
 */
const MODULE_COMMERCIALS = {
  detailing: { payoutAmountCents: 9_000, vendorName: 'Lava Rapido Sao Bento' },
  oficina: { payoutAmountCents: 30_000, vendorName: 'Oficina Torque Racing' },
} as const;

type ModuleKey = keyof typeof MODULE_COMMERCIALS;

type Spec = {
  slug: string;
  name: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  status: PremiumMembershipStatus;
  provider: PremiumProvider;
  /** Quantos ciclos mensais pagos criar antes do ciclo corrente. */
  paidCycles: number;
  modules: ModuleKey[];
  cancelAtPeriodEnd: boolean;
  payment: { brand: string; last4: string } | null;
  /** Deslocamento em dias do fim do periodo corrente, para variar a data de renovacao. */
  renewalInDays: number;
};

const SPECS: Spec[] = [
  {
    // O membro pedido: gold, 6 meses de historico, os dois modulos.
    slug: 'gold',
    name: 'Helena Fundadora',
    tier: 'gold',
    cadence: 'monthly',
    status: 'active',
    provider: 'stripe',
    paidCycles: 6,
    modules: ['detailing', 'oficina'],
    cancelAtPeriodEnd: false,
    payment: { brand: 'visa', last4: '4242' },
    renewalInDays: 12,
  },
  {
    slug: 'silver-inadimplente',
    name: 'Rui Estrada',
    tier: 'silver',
    cadence: 'monthly',
    status: 'past_due',
    provider: 'stripe',
    paidCycles: 3,
    modules: ['detailing'],
    cancelAtPeriodEnd: false,
    payment: { brand: 'mastercard', last4: '5454' },
    renewalInDays: 3,
  },
  {
    slug: 'bronze-cancelando',
    name: 'Ivo Ingresso',
    tier: 'bronze',
    cadence: 'monthly',
    status: 'cancel_scheduled',
    provider: 'stripe',
    paidCycles: 2,
    modules: [],
    cancelAtPeriodEnd: true,
    payment: { brand: 'elo', last4: '8829' },
    renewalInDays: 25,
  },
  {
    slug: 'gold-pausado',
    name: 'Nina Pausa',
    tier: 'gold',
    cadence: 'monthly',
    status: 'paused',
    provider: 'stripe',
    paidCycles: 5,
    modules: ['oficina'],
    cancelAtPeriodEnd: false,
    payment: null, // exercita o fallback "Cartao" sem snapshot
    renewalInDays: 40,
  },
  {
    // apple_revenuecat: a tela de detalhe deve mostrar mutable=false e desabilitar tudo.
    slug: 'gold-apple',
    name: 'Caio App Store',
    tier: 'gold',
    cadence: 'annual',
    status: 'active',
    provider: 'apple_revenuecat',
    paidCycles: 1,
    modules: [],
    cancelAtPeriodEnd: false,
    payment: null, // exercita o fallback "App Store"
    renewalInDays: 200,
  },
];

const emailFor = (slug: string) => `${EMAIL_PREFIX}.${slug}@casacar.club`;

async function wipePrevious(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: `${EMAIL_PREFIX}.` } },
    select: { id: true },
  });
  if (users.length === 0) return;

  const garages = await prisma.garage.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    select: { id: true },
  });
  const garageIds = garages.map((g) => g.id);

  // PremiumMembership -> Cascade limpa invoices e addons, que por sua vez limpam usage.
  await prisma.premiumMembership.deleteMany({ where: { garageId: { in: garageIds } } });
  await prisma.garage.deleteMany({ where: { id: { in: garageIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });

  console.log(`limpou ${users.length} usuario(s) de demo anteriores`);
}

async function applyModuleCommercials(): Promise<void> {
  for (const [key, c] of Object.entries(MODULE_COMMERCIALS)) {
    const updated = await prisma.premiumAddonModule.updateMany({
      where: { key },
      data: { payoutAmountCents: c.payoutAmountCents, vendorName: c.vendorName },
    });
    if (updated.count === 0) {
      throw new Error(
        `modulo "${key}" nao existe no catalogo. Rode "pnpm --filter @ccc/db db:seed" antes.`,
      );
    }
  }
  console.log('repasse e fornecedor aplicados nos modulos do catalogo');
}

async function seedOne(spec: Spec, passwordHash: string, now: Date): Promise<void> {
  const email = emailFor(spec.slug);

  const user = await prisma.user.create({
    data: {
      email,
      name: spec.name,
      passwordHash,
      role: 'user',
      emailVerifiedAt: now,
    },
  });

  const currentPeriodEnd = new Date(now.getTime() + spec.renewalInDays * DAY);
  const cycleLength = spec.cadence === 'annual' ? 12 * MONTH : MONTH;
  const currentPeriodStart = new Date(currentPeriodEnd.getTime() - cycleLength);

  const garage = await prisma.garage.create({
    data: {
      userId: user.id,
      name: `Garagem ${spec.name.split(' ')[0]}`,
      slug: `demo-${spec.slug}`,
      isPublic: false,
      // Snapshot de entitlement. `paused` mantem a titularidade paga, igual a past_due.
      premiumTier: spec.tier,
      premiumUntil: currentPeriodEnd,
    },
  });

  const baseAmountCents = BASE_BY_TIER[spec.tier];
  const addonsAmountCents = spec.modules.reduce(
    (sum, key) => sum + (key === 'detailing' ? 15_000 : 50_000),
    0,
  );

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: spec.provider,
      providerCustomerRef: `cus_demo_${spec.slug}`,
      providerSubRef: `sub_demo_${spec.slug}`,
      tier: spec.tier,
      cadence: spec.cadence,
      status: spec.status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: spec.cancelAtPeriodEnd,
      cancelledAt: spec.cancelAtPeriodEnd ? new Date(now.getTime() - 2 * DAY) : null,
      baseAmountCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: baseAmountCents + addonsAmountCents,
      addonsAmountCents,
      currency: 'BRL',
      paymentBrand: spec.payment?.brand ?? null,
      paymentLast4: spec.payment?.last4 ?? null,
    },
  });

  // Historico: um invoice pago por ciclo anterior, do mais antigo para o mais recente.
  for (let i = spec.paidCycles; i >= 1; i -= 1) {
    const periodStart = new Date(currentPeriodStart.getTime() - i * cycleLength);
    const periodEnd = new Date(periodStart.getTime() + cycleLength);
    await prisma.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider: spec.provider,
        providerInvoiceRef: `in_demo_${spec.slug}_${i}`,
        periodStart,
        periodEnd,
        baseAmountCents,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        grossAmountCents: baseAmountCents + addonsAmountCents,
        addonsAmountCents,
        currency: 'BRL',
        paidAt: periodStart,
        status: 'paid',
      },
    });
  }

  for (const key of spec.modules) {
    const mod = await prisma.premiumAddonModule.findUniqueOrThrow({ where: { key } });
    const addon = await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: key,
        status: 'active',
        // Preenchido: a tela mostra "a Stripe nao esta cobrando" quando isto e null.
        providerItemRef: `si_demo_${spec.slug}_${key}`,
        monthlyDeltaCents: mod.monthlyDeltaCents,
        payoutAmountCents: mod.payoutAmountCents,
        vendorName: mod.vendorName,
        quotaPerCycle: mod.quotaPerCycle,
        quotaUnit: mod.quotaUnit,
        currency: mod.currency,
      },
    });

    await prisma.premiumAddonUsage.create({
      data: {
        membershipAddonId: addon.id,
        cycleStart: currentPeriodStart,
        cycleEnd: currentPeriodEnd,
        quotaTotal: mod.quotaPerCycle,
        // Consumo parcial, para a coluna de cota mostrar algo diferente de 0.
        quotaUsed: Math.min(1, mod.quotaPerCycle),
      },
    });
  }

  console.log(
    `  ${email.padEnd(46)} ${spec.tier.padEnd(6)} ${spec.cadence.padEnd(7)} ` +
      `${spec.status.padEnd(17)} ${spec.provider.padEnd(17)} ` +
      `${spec.paidCycles} faturas, ${spec.modules.length} modulo(s)`,
  );
}

async function main(): Promise<void> {
  const now = new Date();

  await wipePrevious();
  await applyModuleCommercials();

  const passwordHash = await hashPassword(PASSWORD);

  console.log('\nassinaturas criadas:');
  for (const spec of SPECS) {
    await seedOne(spec, passwordHash, now);
  }

  console.log(`\nsenha de todos: ${PASSWORD}`);
  console.log('membro principal: ' + emailFor('gold'));
  console.log('\nabra /assinaturas no admin. filtros exercitaveis:');
  console.log('  status    active, past_due, cancel_scheduled, paused');
  console.log('  tier      bronze, silver, gold');
  console.log('  cadencia  monthly, annual');
  console.log('  provider  stripe, apple_revenuecat');
  console.log('  modulo    detailing, oficina');
  console.log(
    '  fornecedor  ' +
      Object.values(MODULE_COMMERCIALS)
        .map((c) => c.vendorName)
        .join(', '),
  );
  console.log('  renovacao   proximos 3 a 200 dias');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
