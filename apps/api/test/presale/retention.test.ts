// Purga do convidado abandonado da pré-venda Casa In Box (T17). Três provas
// pinam os três invariantes de purgeAbandonedPresaleGuests: purga o
// abandonado, nunca toca pedido pago (por mais antigo que seja) e nunca toca
// pedido que não é origin: casa_in_box. Datas sempre relativas a um `now`
// injetado — nunca literal fixo (CLAUDE.md).
//
// I2: a mesma purga também tem que redigir guestEmail/guestName de dentro de
// Consent.evidence para os MESMOS pedidos que alcança — checkout.ts:471
// grava esses dois campos lá, e a purga de PresaleGuest nunca tocava esse
// JSON. A linha de Consent sobrevive sempre (prova do consentimento); só as
// chaves que identificam a pessoa são redigidas.
import { ensurePresaleSystemUser, prisma } from '@ccc/db';
import type { OrderOrigin, OrderStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { purgeAbandonedPresaleGuests } from '../../src/workers/retention.js';
import { resetDatabase } from '../helpers.js';

const MS_PER_DAY = 24 * 3600_000;
const RETENTION_DAYS = 90;

const createPresaleOrder = async (opts: {
  status: OrderStatus;
  createdAt: Date;
  origin?: OrderOrigin;
  // Override for the refunded-but-was-paid case: routes/stripe-webhook.ts
  // flips `status` to 'refunded' on a full refund but never clears `paidAt`
  // (it still records the moment the order WAS paid). Defaults to the old
  // paid-iff-status-paid behavior so the other tests don't need to change.
  paidAt?: Date | null;
}) => {
  const userId = await ensurePresaleSystemUser();
  const suffix = Math.random().toString(36).slice(2, 10);
  return prisma.order.create({
    data: {
      userId,
      kind: 'product',
      amountCents: 9900,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      providerRef: `pi_retention_test_${suffix}`,
      status: opts.status,
      origin: opts.origin ?? 'casa_in_box',
      createdAt: opts.createdAt,
      paidAt:
        opts.paidAt !== undefined ? opts.paidAt : opts.status === 'paid' ? opts.createdAt : null,
      presaleGuest: {
        create: {
          name: 'Convidado Teste',
          email: `convidado-${suffix}@exemplo.com`,
        },
      },
    },
  });
};

// Mesmo shape que checkout.ts:471 grava de verdade: userId null (é o
// discriminador que a purga usa para achar só consent de convidado da
// pré-venda) e evidence com guestEmail/guestName ao lado do orderId.
const createPresaleConsent = (orderId: string, opts: { guestEmail?: string } = {}) =>
  prisma.consent.create({
    data: {
      userId: null,
      purpose: 'privacy_notice',
      version: 'privacy-2026-01-01',
      channel: 'web_public',
      ipAddress: null,
      userAgent: null,
      evidence: {
        source: 'presale_checkout',
        orderId,
        clientRequestId: `req-${orderId}`,
        guestEmail: opts.guestEmail ?? 'convidado@exemplo.com',
        guestName: 'Convidado Teste',
        acceptedPrivacyVersion: 'privacy-2026-01-01',
        acceptedTermsVersion: 'terms-2026-01-01',
      },
    },
  });

describe('purgeAbandonedPresaleGuests', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('purga convidado e pedido não pago depois do prazo', async () => {
    const now = new Date();
    const abandoned = await createPresaleOrder({
      status: 'expired',
      createdAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
    });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    await expect(
      prisma.presaleGuest.findUnique({ where: { orderId: abandoned.id } }),
    ).resolves.toBeNull();
  });

  it('não toca pedido abandonado ainda dentro do prazo de carência', async () => {
    const now = new Date();
    const recent = await createPresaleOrder({
      status: 'pending',
      createdAt: new Date(now.getTime() - (RETENTION_DAYS - 1) * MS_PER_DAY),
    });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    await expect(
      prisma.presaleGuest.findUnique({ where: { orderId: recent.id } }),
    ).resolves.not.toBeNull();
  });

  it('nunca toca pedido pago, por mais antigo que seja', async () => {
    const now = new Date();
    const paidOld = await createPresaleOrder({
      status: 'paid',
      createdAt: new Date(now.getTime() - 10 * 365 * MS_PER_DAY),
    });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    await expect(
      prisma.presaleGuest.findUnique({ where: { orderId: paidOld.id } }),
    ).resolves.not.toBeNull();
  });

  it('nunca toca pedido pago e depois estornado, por mais antigo que seja (T17-C1)', async () => {
    // routes/stripe-webhook.ts:646-653 vira `status: 'paid'` -> 'refunded' num
    // reembolso total da Stripe e NÃO limpa `paidAt`. Esse pedido passava no
    // filtro antigo `status: { not: 'paid' }` porque 'refunded' !== 'paid'.
    // `paidAt` continua preenchido com a data em que foi pago de verdade —
    // esse é o sinal certo de "já foi pago alguma vez", não o status atual.
    const now = new Date();
    const paidThenRefunded = await createPresaleOrder({
      status: 'refunded',
      createdAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
      paidAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
    });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    await expect(
      prisma.presaleGuest.findUnique({ where: { orderId: paidThenRefunded.id } }),
    ).resolves.not.toBeNull();
  });

  it('nunca toca pedido que não é de pré-venda', async () => {
    const now = new Date();
    // Mesma idade e mesmo status "abandonado" do primeiro teste — a única
    // diferença é origin: 'app'. Se a purga não filtrasse por origin ela
    // apagaria este também; ao sobreviver, prova que o filtro é por origin,
    // não só por status/idade.
    const nonPresale = await createPresaleOrder({
      status: 'expired',
      createdAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
      origin: 'app',
    });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    await expect(
      prisma.presaleGuest.findUnique({ where: { orderId: nonPresale.id } }),
    ).resolves.not.toBeNull();
  });

  it('redige guestEmail/guestName de dentro de Consent.evidence do pedido abandonado purgado (I2)', async () => {
    const now = new Date();
    const abandoned = await createPresaleOrder({
      status: 'expired',
      createdAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
    });
    const consent = await createPresaleConsent(abandoned.id);

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    const after = await prisma.consent.findUniqueOrThrow({ where: { id: consent.id } });
    // A linha sobrevive — é a prova do consentimento, com data e versão de
    // política — mas o que identifica a pessoa dentro dela não.
    const evidence = after.evidence as Record<string, unknown>;
    expect(evidence.guestEmail).toBe('[purgado]');
    expect(evidence.guestName).toBe('[purgado]');
    // Campos não identificadores continuam intactos.
    expect(evidence.orderId).toBe(abandoned.id);
    expect(evidence.acceptedPrivacyVersion).toBe('privacy-2026-01-01');
  });

  it('nunca redige Consent.evidence de pedido pago, por mais antigo que seja (I2)', async () => {
    const now = new Date();
    const paidOld = await createPresaleOrder({
      status: 'paid',
      createdAt: new Date(now.getTime() - 10 * 365 * MS_PER_DAY),
    });
    const consent = await createPresaleConsent(paidOld.id, { guestEmail: 'pago@exemplo.com' });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    const after = await prisma.consent.findUniqueOrThrow({ where: { id: consent.id } });
    const evidence = after.evidence as Record<string, unknown>;
    expect(evidence.guestEmail).toBe('pago@exemplo.com');
    expect(evidence.guestName).toBe('Convidado Teste');
  });

  it('nunca redige Consent.evidence de pedido pago e depois estornado, por mais antigo que seja (I2)', async () => {
    const now = new Date();
    const paidThenRefunded = await createPresaleOrder({
      status: 'refunded',
      createdAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
      paidAt: new Date(now.getTime() - (RETENTION_DAYS + 1) * MS_PER_DAY),
    });
    const consent = await createPresaleConsent(paidThenRefunded.id, {
      guestEmail: 'estornado@exemplo.com',
    });

    await purgeAbandonedPresaleGuests(now, RETENTION_DAYS);

    const after = await prisma.consent.findUniqueOrThrow({ where: { id: consent.id } });
    const evidence = after.evidence as Record<string, unknown>;
    expect(evidence.guestEmail).toBe('estornado@exemplo.com');
    expect(evidence.guestName).toBe('Convidado Teste');
  });
});
