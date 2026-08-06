import { prisma } from '@ccc/db';
import { adminFinanceMembershipsResponseSchema } from '@ccc/shared/admin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

const MODULES = [
  { key: 'detailing', name: 'Detailing', vendorName: 'Lava Rápido X', cents: 15000 },
  { key: 'oficina', name: 'Oficina', vendorName: 'Oficina Y', cents: 50000 },
] as const;

// resetDatabase() (test/helpers.ts) deliberately does not truncate the addon
// catalog tables — clean them in both hooks, mirroring resetCatalog() in
// admin/subscriptions/detail.test.ts.
const resetCatalog = async (): Promise<void> => {
  await prisma.premiumMembershipAddon.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

async function createSubscription(opts: {
  email: string;
  addonKey?: 'detailing' | 'oficina';
}): Promise<string> {
  const { user } = await createUser({ email: opts.email, name: opts.email, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const mod = MODULES.find((m) => m.key === opts.addonKey);

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: `cus_${opts.email}`,
      providerSubRef: `sub_${opts.email}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      addonsAmountCents: mod?.cents ?? 0,
      currency: 'BRL',
    },
  });

  if (mod) {
    await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: mod.key,
        status: 'active',
        monthlyDeltaCents: mod.cents,
        payoutAmountCents: Math.floor(mod.cents * 0.6),
        vendorName: mod.vendorName,
        quotaPerCycle: 3,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });
  }

  return membership.id;
}

describe('GET /admin/finance/memberships: filtros de modulo e fornecedor', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  let auth: string;
  let comDetailing: string;
  let comOficina: string;
  let semModulo: string;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    app = await makeApp();

    for (const m of MODULES) {
      await prisma.premiumAddonModule.create({
        data: {
          key: m.key,
          name: m.name,
          description: m.name,
          monthlyDeltaCents: m.cents,
          payoutAmountCents: Math.floor(m.cents * 0.6),
          vendorName: m.vendorName,
          quotaPerCycle: 3,
          quotaUnit: 'access',
          currency: 'BRL',
        },
      });
    }

    comDetailing = await createSubscription({ email: 'd@example.com', addonKey: 'detailing' });
    comOficina = await createSubscription({ email: 'o@example.com', addonKey: 'oficina' });
    semModulo = await createSubscription({ email: 'n@example.com' });

    const { user: admin } = await createUser({
      email: 'admin@example.com',
      role: 'admin',
      verified: true,
    });
    auth = bearer(loadEnv(), admin.id, 'admin');
  });

  afterEach(async () => {
    await app.close();
    await resetCatalog();
  });

  const list = async (qs: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/finance/memberships${qs}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    return adminFinanceMembershipsResponseSchema.parse(res.json());
  };

  it('addonKey retorna so quem tem o modulo vinculado', async () => {
    const body = await list('?addonKey=detailing');
    expect(body.items.map((i) => i.membershipId)).toEqual([comDetailing]);
    expect(body.total).toBe(1);
  });

  it('addonKey ignora vinculo cancelled', async () => {
    await prisma.premiumMembershipAddon.updateMany({
      where: { membershipId: comDetailing },
      data: { status: 'cancelled' },
    });
    const body = await list('?addonKey=detailing');
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('addonKey inclui vinculo cancel_scheduled', async () => {
    await prisma.premiumMembershipAddon.updateMany({
      where: { membershipId: comDetailing },
      data: { status: 'cancel_scheduled' },
    });
    const body = await list('?addonKey=detailing');
    expect(body.items.map((i) => i.membershipId)).toEqual([comDetailing]);
  });

  it('vendorName retorna quem tem qualquer modulo daquele fornecedor', async () => {
    const body = await list(`?vendorName=${encodeURIComponent('Oficina Y')}`);
    expect(body.items.map((i) => i.membershipId)).toEqual([comOficina]);
  });

  it('addonKey e vendorName combinados aplicam as duas restricoes', async () => {
    const body = await list(`?addonKey=detailing&vendorName=${encodeURIComponent('Oficina Y')}`);
    expect(body.items).toEqual([]);
  });

  it('from e to continuam filtrando currentPeriodEnd', async () => {
    const dentro = await list('?from=2026-08-25&to=2026-09-05');
    expect(dentro.total).toBe(3);

    const fora = await list('?from=2026-10-01&to=2026-10-31');
    expect(fora.total).toBe(0);
  });

  it('a resposta traz os campos novos', async () => {
    const body = await list('');

    const comMod = body.items.find((i) => i.membershipId === comDetailing);
    expect(comMod).toMatchObject({
      userEmail: 'd@example.com',
      baseAmountCents: 149000,
      addonsAmountCents: 15000,
      addonKeys: ['detailing'],
    });
    expect(comMod?.userId).toBeTruthy();

    const sem = body.items.find((i) => i.membershipId === semModulo);
    expect(sem?.addonKeys).toEqual([]);
    expect(sem?.addonsAmountCents).toBe(0);
  });
});
