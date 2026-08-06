import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attachAddon, detachAddon } from '../../src/services/billing/addons.js';
import { isBillingActionError } from '../../src/services/billing/errors.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

// resetDatabase() (test/helpers.ts) truncates premiumMembership (cascading to
// premiumMembershipAddon/premiumAddonUsage) but not the catalog table
// premiumAddonModule — mirrors the local resetCatalog() in
// premium-addon-billing.test.ts and premium-subscription.test.ts.
const resetCatalog = async (): Promise<void> => {
  await prisma.premiumAddonModule.deleteMany();
};

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

async function seed(opts: { stripePriceId?: string | null } = {}) {
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
      active: true,
      stripePriceId: opts.stripePriceId === undefined ? 'price_detailing' : opts.stripePriceId,
    },
  });
  return { membershipId: membership.id };
}

describe('attachAddon', () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });
  afterEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });

  it('snapshota repasse e fornecedor no vinculo', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    const result = await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(result).toEqual({
      addonKey: 'detailing',
      status: 'active',
      addonsAmountCents: 15000,
      totalAmountCents: 164000,
    });

    const addon = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { membershipId, addonKey: 'detailing' },
    });
    expect(addon.payoutAmountCents).toBe(9000);
    expect(addon.vendorName).toBe('Lava Rápido X');
    expect(addon.monthlyDeltaCents).toBe(15000);
    expect(addon.providerItemRef).toBe('si_fake_1');
  });

  it('chama a Stripe antes de gravar e abre o ciclo alinhado ao periodo', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(stripe.calls).toEqual([
      {
        kind: 'addSubscriptionItem',
        payload: {
          subscriptionId: 'sub_1',
          priceId: 'price_detailing',
          idempotencyKey: `addon_attach_${membershipId}_detailing`,
        },
      },
    ]);

    const usage = await prisma.premiumAddonUsage.findFirstOrThrow({});
    expect(usage.cycleStart.toISOString()).toBe(PERIOD_START.toISOString());
    expect(usage.cycleEnd.toISOString()).toBe(PERIOD_END.toISOString());
    expect(usage.quotaTotal).toBe(3);
  });

  it('falha na Stripe deixa o banco intacto', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextAddSubscriptionItemError = new Error('stripe down');

    await expect(
      attachAddon({ membershipId, addonKey: 'detailing', stripe, logger }),
    ).rejects.toThrow('stripe down');

    expect(await prisma.premiumMembershipAddon.count()).toBe(0);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.addonsAmountCents).toBe(0);
  });

  it('sem stripePriceId cai em local-only sem lancar', async () => {
    const { membershipId } = await seed({ stripePriceId: null });
    const stripe = buildFakeStripe();

    const result = await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(result.status).toBe('active');
    expect(stripe.calls).toEqual([]);
    const addon = await prisma.premiumMembershipAddon.findFirstOrThrow({ where: { membershipId } });
    expect(addon.providerItemRef).toBeNull();
  });

  it('modulo inexistente lanca ModuleNotFound', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger }).catch(() => undefined);

    const err = await attachAddon({ membershipId, addonKey: 'inexistente', stripe, logger }).catch(
      (e: unknown) => e,
    );
    expect(isBillingActionError(err) && err.code).toBe('ModuleNotFound');
  });

  it('vinculo duplicado lanca AddonAlreadyAttached', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    const err = await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger }).catch(
      (e: unknown) => e,
    );
    expect(isBillingActionError(err) && err.code).toBe('AddonAlreadyAttached');
  });

  it('assinatura inexistente lanca MembershipNotFound', async () => {
    const stripe = buildFakeStripe();
    const err = await attachAddon({
      membershipId: 'mem_inexistente',
      addonKey: 'detailing',
      stripe,
      logger,
    }).catch((e: unknown) => e);
    expect(isBillingActionError(err) && err.code).toBe('MembershipNotFound');
  });
});

describe('detachAddon', () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });
  afterEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });

  it('marca cancel_scheduled, nunca apaga, e recalcula o total', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    const result = await detachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(result).toEqual({
      addonKey: 'detailing',
      status: 'cancel_scheduled',
      addonsAmountCents: 0,
      totalAmountCents: 149000,
    });

    const addon = await prisma.premiumMembershipAddon.findFirstOrThrow({ where: { membershipId } });
    expect(addon.status).toBe('cancel_scheduled');
    expect(stripe.calls.at(-1)).toEqual({
      kind: 'removeSubscriptionItem',
      payload: { subscriptionItemId: 'si_fake_1', idempotencyKey: `addon_detach_${addon.id}` },
    });
  });

  it('modulo nao vinculado lanca AddonNotAttached', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    const err = await detachAddon({ membershipId, addonKey: 'detailing', stripe, logger }).catch(
      (e: unknown) => e,
    );
    expect(isBillingActionError(err) && err.code).toBe('AddonNotAttached');
  });
});
