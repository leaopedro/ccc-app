import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { reapAbandonedAttempts } from '../../src/workers/billing-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

let seedCounter = 0;
const nextEmail = () => {
  seedCounter += 1;
  return `reaptest-${Date.now()}-${seedCounter}@jdm.test`;
};

const seedAttempt = async (
  garageId: string,
  ageMs: number,
  overrides: { providerSubRef?: string } = {},
) => {
  const row = await prisma.premiumSubscriptionAttempt.create({
    data: {
      garageId,
      cadence: 'monthly',
      planTier: 'gold',
      packageDigest: 'aaa',
      idempotencyKey: `sub_${garageId}_monthly_aaa_x`,
      status: 'pending',
      ...(overrides.providerSubRef ? { providerSubRef: overrides.providerSubRef } : {}),
    },
  });
  // createdAt tem default(now()); empurrar para tras direto no banco.
  await prisma.$executeRaw`UPDATE "PremiumSubscriptionAttempt"
    SET "createdAt" = ${new Date(Date.now() - ageMs)} WHERE id = ${row.id}`;
  return row;
};

const newGarage = async () => {
  const { user } = await createUser({ email: nextEmail(), verified: true });
  return prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
};

describe('reapAbandonedAttempts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reapa tentativa pendente COM providerSubRef e mais de 23h', async () => {
    const garage = await newGarage();
    const attempt = await seedAttempt(garage.id, 24 * HOUR, { providerSubRef: 'sub_live_1' });

    const reaped = await reapAbandonedAttempts(new Date());

    expect(reaped).toBe(1);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('abandoned');
  });

  it('nao reapa tentativa COM providerSubRef e 22h (dentro da janela de 23h)', async () => {
    const garage = await newGarage();
    const attempt = await seedAttempt(garage.id, 22 * HOUR, { providerSubRef: 'sub_live_2' });

    expect(await reapAbandonedAttempts(new Date())).toBe(0);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('pending');
  });

  it('reapa tentativa SEM providerSubRef com mais de 15min (janela curta)', async () => {
    const garage = await newGarage();
    const attempt = await seedAttempt(garage.id, 20 * MIN);

    expect(attempt.providerSubRef).toBeNull();
    const reaped = await reapAbandonedAttempts(new Date());

    expect(reaped).toBe(1);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('abandoned');
  });

  it('nao reapa tentativa SEM providerSubRef dentro da janela curta de 15min', async () => {
    const garage = await newGarage();
    const attempt = await seedAttempt(garage.id, 5 * MIN);

    expect(await reapAbandonedAttempts(new Date())).toBe(0);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('pending');
  });

  // Reapar libera o indice parcial. Sem isso o membro fica travado para sempre.
  it('depois do reaping a garagem aceita tentativa nova', async () => {
    const garage = await newGarage();
    await seedAttempt(garage.id, 24 * HOUR, { providerSubRef: 'sub_live_3' });

    await reapAbandonedAttempts(new Date());

    const nova = await prisma.premiumSubscriptionAttempt.create({
      data: {
        garageId: garage.id,
        cadence: 'monthly',
        planTier: 'gold',
        packageDigest: 'bbb',
        idempotencyKey: `sub_${garage.id}_monthly_bbb_y`,
        status: 'pending',
      },
    });
    expect(nova.status).toBe('pending');
  });

  it('nao mexe em tentativa que ja virou succeeded, mesmo velha', async () => {
    const garage = await newGarage();
    const attempt = await seedAttempt(garage.id, 48 * HOUR, { providerSubRef: 'sub_paid_1' });
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: attempt.id },
      data: { status: 'succeeded' },
    });

    expect(await reapAbandonedAttempts(new Date())).toBe(0);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('succeeded');
  });

  it('nao reprocessa tentativa ja abandoned ou failed', async () => {
    const garage1 = await newGarage();
    const abandoned = await seedAttempt(garage1.id, 48 * HOUR);
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: abandoned.id },
      data: { status: 'abandoned' },
    });

    const garage2 = await newGarage();
    const failed = await seedAttempt(garage2.id, 48 * HOUR, { providerSubRef: 'sub_failed_1' });
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: failed.id },
      data: { status: 'failed' },
    });

    expect(await reapAbandonedAttempts(new Date())).toBe(0);
  });

  // NAO ha teste "nao faz nenhuma chamada Stripe" aqui de proposito: uma
  // versao anterior instanciava um FakeStripe nunca conectado a nada e
  // afirmava `stripe.calls` vazio — isso passa incondicionalmente contra
  // QUALQUER implementacao, inclusive uma que chamasse a Stripe por outro
  // handle. Removido por ser teste vazio (nao pode falhar).
  //
  // A garantia e estrutural, nao testavel por essa via: a assinatura de
  // `reapAbandonedAttempts` e `(now: Date, log?: FastifyBaseLogger) =>
  // Promise<number>` — nao recebe um StripeClient. E `billing-reconcile.ts`
  // nao guarda nenhum handle de Stripe em escopo de modulo (o unico
  // StripeClient do arquivo chega via `ReconcileTickDeps.stripe`, injetado
  // por chamada em `runReconcileTick`/`startReconcileWorker`, fora do
  // caminho de `reapAbandonedAttempts`). Sem uma referencia a um
  // StripeClient em escopo, a funcao nao tem como emitir uma chamada.
});
