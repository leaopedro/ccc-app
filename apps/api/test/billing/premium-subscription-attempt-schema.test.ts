import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

const attempt = (garageId: string, cadence: 'monthly' | 'annual', digest: string) => ({
  garageId,
  cadence,
  planTier: 'gold' as const,
  packageDigest: digest,
  idempotencyKey: `sub_${garageId}_${cadence}_${digest}_seed`,
  status: 'pending' as const,
});

describe('PremiumSubscriptionAttempt', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('aceita uma tentativa pendente por garagem', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const row = await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'aaa'),
    });
    expect(row.status).toBe('pending');
  });

  // Esta e a guarda. Dois toques concorrentes tem que colapsar numa tentativa.
  it('recusa uma segunda tentativa pendente da mesma garagem', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'aaa'),
    });

    await expect(
      prisma.premiumSubscriptionAttempt.create({
        data: attempt(garage.id, 'annual', 'bbb'),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // Recontratar depois de cancelar e caso obrigatorio. O indice e parcial
  // exatamente para nao bloqueá-lo.
  it('aceita nova tentativa depois de a anterior sair de pending', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const first = await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'aaa'),
    });
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: first.id },
      data: { status: 'succeeded', providerSubRef: 'sub_live_1' },
    });

    const second = await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'ccc'),
    });
    expect(second.id).not.toBe(first.id);
  });

  it('permite tentativas pendentes de garagens diferentes', async () => {
    const a = await createUser({ verified: true, email: 'a@casacar.test' });
    const b = await createUser({ verified: true, email: 'b@casacar.test' });
    const ga = await prisma.garage.findUniqueOrThrow({ where: { userId: a.user.id } });
    const gb = await prisma.garage.findUniqueOrThrow({ where: { userId: b.user.id } });

    await prisma.premiumSubscriptionAttempt.create({ data: attempt(ga.id, 'monthly', 'aaa') });
    await prisma.premiumSubscriptionAttempt.create({ data: attempt(gb.id, 'monthly', 'aaa') });

    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(2);
  });

  // PremiumMembership tem que continuar sem restricao NOVA de duplicidade por
  // garagem introduzida por esta tarefa. Uma restricao dessas impediria o
  // BANCO de registrar assinatura que a Stripe JA COBROU.
  //
  // Nota: PremiumMembership ja tem um indice unico parcial PRE-EXISTENTE,
  // nao tocado por esta tarefa (`premium_membership_live_per_garage`,
  // migracao 20260527094120_f8_premium_billing), que restringe UMA linha por
  // garagem entre os status active/past_due/cancel_scheduled. Por isso o teste
  // usa status 'expired' (fora desse conjunto) para provar que nao ha
  // restricao total sobre garageId, sem tropecar na regra antiga e
  // intencional de "uma assinatura viva por garagem".
  it('PremiumMembership continua aceitando duas linhas na mesma garagem', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const base = {
      garageId: garage.id,
      provider: 'stripe' as const,
      providerCustomerRef: 'cus_1',
      tier: 'gold' as const,
      cadence: 'monthly' as const,
      status: 'expired' as const,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      baseAmountCents: 24_990,
      devFeePercent: 10,
      devFeeAmountCents: 2499,
      grossAmountCents: 27_489,
      currency: 'BRL',
    };

    await prisma.premiumMembership.create({ data: { ...base, providerSubRef: 'sub_1' } });
    await prisma.premiumMembership.create({ data: { ...base, providerSubRef: 'sub_2' } });

    expect(await prisma.premiumMembership.count({ where: { garageId: garage.id } })).toBe(2);
  });

  // Mesmo padrao de schema-f8.test.ts:122-131 para
  // premium_membership_live_per_garage. O comportamento acima (testes 2 e 3)
  // passaria igual sob um predicado ERRADO mas parecido, por exemplo
  // `status IN ('pending', 'succeeded')` — so essa asserção fixa a definição
  // real do indice (nome E predicado) no pg_indexes, entao um `prisma migrate
  // dev` futuro que tentar dropar o indice (porque ele e invisivel ao
  // schema.prisma) quebra aqui antes de virar um DROP INDEX silencioso.
  it('confirma que o indice unico parcial existe no pg_indexes com o predicado certo', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'PremiumSubscriptionAttempt'
        AND indexname = 'PremiumSubscriptionAttempt_garageId_pending_unique'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE/i);
    expect(rows[0]!.indexdef).toMatch(/\(status = 'pending'::"PremiumSubscriptionAttemptStatus"\)/);
  });
});
