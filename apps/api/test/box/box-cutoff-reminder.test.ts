import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { CUTOFF_SOON_COPY } from '../../src/services/box/notifications.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { runBoxCutoffReminderTick } from '../../src/workers/box-cutoff.js';
import { runNotificationDeliveryTick } from '../../src/workers/notification-delivery.js';
import { createUser, resetDatabase } from '../helpers.js';

const NOW = new Date('2026-08-01T00:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

const makeBox = async (over: { status?: string; cutoffAt: Date; withItem?: boolean }) => {
  const { user } = await createUser({
    verified: true,
    email: `u${Math.random().toString(36).slice(2, 7)}@jdm.test`,
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-07-05T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-05T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-07-05',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: over.cutoffAt,
      budgetCentsSnapshot: 10000,
      status: (over.status ?? 'open') as never,
    },
  });
  if (over.withItem) {
    const item = await prisma.boxCatalogItem.create({
      data: {
        slug: `it${Math.random().toString(36).slice(2, 7)}`,
        title: 'Adesivo',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Adesivo',
      },
    });
  }
  return { user, box };
};

const reminders = (userId: string) =>
  prisma.notification.findMany({ where: { userId, kind: 'box.cutoff_soon' } });

describe('runBoxCutoffReminderTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('warns an open box whose cutoff is inside the window', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(1);
  });

  it('does not warn a box whose cutoff is still beyond the window', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 72 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(0);
  });

  it('does not warn a box whose cutoff already passed', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() - HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(0);
  });

  it('does not warn a box that is no longer open', async () => {
    const { user } = await makeBox({
      status: 'skipped',
      cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(0);
  });

  it('warns an awaiting_payment box too', async () => {
    const { user } = await makeBox({
      status: 'awaiting_payment',
      withItem: true,
      cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(1);
  });

  it('warns once per box across repeated ticks', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    await runBoxCutoffReminderTick({ now: new Date(NOW.getTime() + HOUR_MS) });
    await runBoxCutoffReminderTick({ now: new Date(NOW.getTime() + 2 * HOUR_MS) });
    expect(await reminders(user.id)).toHaveLength(1);
  });

  // Comparar os tres corpos entre si so prova que diferem: trocar dois arms do
  // ternario passaria. Cada um e checado contra a copy da SUA chave.
  it('escolhe a copy de cada um dos tres estados', async () => {
    const soon = new Date(NOW.getTime() + 24 * HOUR_MS);
    const { user: emptyUser } = await makeBox({ cutoffAt: soon });
    const { user: builtUser } = await makeBox({ withItem: true, cutoffAt: soon });
    const { user: unpaidUser } = await makeBox({
      status: 'awaiting_payment',
      withItem: true,
      cutoffAt: soon,
    });

    await runBoxCutoffReminderTick({ now: NOW });

    expect((await reminders(emptyUser.id))[0]?.body).toBe(CUTOFF_SOON_COPY.empty.body);
    expect((await reminders(builtUser.id))[0]?.body).toBe(CUTOFF_SOON_COPY.unconfirmed.body);
    expect((await reminders(unpaidUser.id))[0]?.body).toBe(CUTOFF_SOON_COPY.unpaid.body);
  });

  // O teto do lote so e um teto se o conjunto encolher. Sem o predicado de
  // "ja avisei", a consulta devolve as mesmas primeiras linhas todo minuto e
  // quem esta atras do teto nunca e alcancado.
  it('tira do conjunto a caixa ja avisada, em vez de reselecionar a mesma', async () => {
    const { box } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });

    const marked = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(marked.cutoffRemindedCase).toBe('empty');

    // Mesma consulta do worker, no tick seguinte: a caixa nao pode mais vir.
    const stillDue = await prisma.monthlyBox.count({
      where: {
        id: box.id,
        cutoffAt: { gt: NOW },
        OR: [
          { AND: [{ status: 'awaiting_payment' }, { cutoffRemindedCase: { not: 'unpaid' } }] },
          {
            AND: [
              { status: 'open', items: { some: { included: true } } },
              { cutoffRemindedCase: { not: 'unconfirmed' } },
            ],
          },
          {
            AND: [
              { status: 'open', items: { none: { included: true } } },
              { cutoffRemindedCase: { not: 'empty' } },
            ],
          },
        ],
      },
    });
    expect(stillDue).toBe(0);
  });

  // O membro avisado como `empty` em T-48h que depois monta e para no
  // pagamento precisa ouvir sobre o pagamento. E o estado onde o corte corta a
  // caixa pelo budget, e era o buraco da chave de dedupe so com a caixa.
  it('avisa de novo quando o estado da caixa muda', async () => {
    const { user, box } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 40 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    expect(await reminders(user.id)).toHaveLength(1);

    const item = await prisma.boxCatalogItem.create({
      data: {
        slug: `it${Math.random().toString(36).slice(2, 7)}`,
        title: 'Adesivo',
        description: 'x',
        priceCents: 3000,
        category: 'sticker',
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id,
        quantity: 1,
        unitPriceCents: 3000,
        subtotalCents: 3000,
        titleSnapshot: 'Adesivo',
      },
    });
    await prisma.monthlyBox.update({
      where: { id: box.id },
      data: { status: 'awaiting_payment' },
    });

    await runBoxCutoffReminderTick({ now: new Date(NOW.getTime() + HOUR_MS) });

    const rows = await reminders(user.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.body)).toContain(CUTOFF_SOON_COPY.unpaid.body);
  });

  it('lands the member on the box screen', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await runBoxCutoffReminderTick({ now: NOW });
    const [row] = await reminders(user.id);
    expect(row?.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
    expect(row?.data).toMatchObject({ boxId: expect.any(String) });
  });

  // A linha no banco nao e o aviso. O aviso e o push, e quem o envia e o
  // worker de entrega, que varre por `kind IN (DELIVERABLE_KINDS)`. Um kind
  // novo que nao entre nessa lista produz uma fila de linhas com `sentAt`
  // nulo para sempre: a feature parece pronta, os testes de enfileiramento
  // passam, e o membro nunca recebe nada. Esta prova so passa fim a fim.
  it('entrega o lembrete como push de verdade, nao so como linha no banco', async () => {
    const { user } = await makeBox({ cutoffAt: new Date(NOW.getTime() + 24 * HOUR_MS) });
    await prisma.deviceToken.create({
      data: {
        userId: user.id,
        expoPushToken: 'ExponentPushToken[wcut111111]',
        platform: 'ios',
      },
    });

    await runBoxCutoffReminderTick({ now: NOW });
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: NOW });

    expect(sender.captured).toHaveLength(1);
    const [row] = await reminders(user.id);
    expect(row?.sentAt).not.toBeNull();
  });
});
