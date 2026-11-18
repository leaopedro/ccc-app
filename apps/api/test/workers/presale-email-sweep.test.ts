import { ensurePresaleSystemUser, prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { DevMailer } from '../../src/services/mailer/dev.js';
import { runPresaleEmailSweepTick } from '../../src/workers/presale-email-sweep.js';
import { resetDatabase } from '../helpers.js';
import { createPresaleProduct } from '../presale/fixtures.js';

const env = loadEnv();
const NOW = new Date('2026-09-05T12:00:00.000Z');
const GRACE_MS = 5 * 60_000;

// Achado B (revisão cruzada): confirmation-email.ts e pix-code-email.ts
// carimbam antes de enviar e soltam o carimbo se o mailer falhar, mas nada
// chamava a função de novo depois disso. Esta varredura é o "alguém chama
// de novo" que faltava.
describe('runPresaleEmailSweepTick', () => {
  let mailer: DevMailer;

  beforeEach(async () => {
    await resetDatabase();
    mailer = new DevMailer();
  });

  type SeedOverrides = {
    origin?: 'app' | 'casa_in_box';
    status?: 'pending' | 'paid';
    method?: 'card' | 'pix';
    provider?: 'stripe' | 'abacatepay';
    providerRef?: string;
    paidAt?: Date;
    confirmationEmailSentAt?: Date | null;
    pixCodeEmailSentAt?: Date | null;
    brCode?: string;
    expiresAt?: Date;
    createdAt?: Date;
  };

  const seedBaseOrder = async (overrides: SeedOverrides = {}) => {
    const systemUserId = await ensurePresaleSystemUser();
    const product = await createPresaleProduct(
      { allowPickup: true, allowShip: true },
      { variants: [{ priceCents: 9900, quantityTotal: 10 }] },
    );
    const variantId = product.variants[0]!.id;
    const suffix = Math.random().toString(36).slice(2, 10);

    return prisma.order.create({
      data: {
        userId: systemUserId,
        kind: 'product',
        origin: 'casa_in_box',
        amountCents: 19800,
        baseAmountCents: 19800,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: `pi_test_${suffix}`,
        status: 'pending',
        quantity: 2,
        fulfillmentMethod: 'pickup',
        items: {
          create: {
            kind: 'product',
            variantId,
            quantity: 2,
            unitPriceCents: 9900,
            subtotalCents: 19800,
          },
        },
        presaleGuest: {
          create: {
            name: 'Comprador Teste',
            email: 'comprador@exemplo.com',
          },
        },
        ...overrides,
      },
    });
  };

  // Teste 1: pedido pago, carimbo de confirmação ausente, liquidado há mais
  // que a carência. A varredura deve enviar e carimbar.
  it('envia e carimba a confirmação de um pedido pago há mais que a carência sem o email', async () => {
    const order = await seedBaseOrder({
      status: 'paid',
      paidAt: new Date(NOW.getTime() - GRACE_MS - 60_000),
      confirmationEmailSentAt: null,
    });

    await runPresaleEmailSweepTick({ mailer, env, alertDepth: 200, now: NOW });

    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.to).toBe('comprador@exemplo.com');

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.confirmationEmailSentAt).not.toBeNull();
  });

  // Teste 2: carimbo já preenchido. A varredura não deve enviar de novo —
  // o compare-and-set das funções de envio já garante isso, mas a própria
  // query da varredura também não deve nem considerar a linha.
  it('não reenvia confirmação quando o carimbo já está preenchido', async () => {
    await seedBaseOrder({
      status: 'paid',
      paidAt: new Date(NOW.getTime() - GRACE_MS - 60_000),
      confirmationEmailSentAt: new Date(NOW.getTime() - 60_000),
    });

    await runPresaleEmailSweepTick({ mailer, env, alertDepth: 200, now: NOW });

    expect(mailer.captured).toHaveLength(0);
  });

  // Teste 3: pedido pago DENTRO da carência. A varredura ainda não deve
  // mexer nele — ele pode ser o envio original ainda em voo.
  it('não envia confirmação de um pedido pago dentro da carência', async () => {
    const order = await seedBaseOrder({
      status: 'paid',
      paidAt: new Date(NOW.getTime() - GRACE_MS / 2),
      confirmationEmailSentAt: null,
    });

    await runPresaleEmailSweepTick({ mailer, env, alertDepth: 200, now: NOW });

    expect(mailer.captured).toHaveLength(0);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.confirmationEmailSentAt).toBeNull();
  });

  // Teste 4: pedido Pix com código vivo, carimbo do código ausente. A
  // varredura deve enviar.
  it('envia o código Pix de um pedido com código vivo e sem o email enviado', async () => {
    const order = await seedBaseOrder({
      status: 'pending',
      method: 'pix',
      provider: 'abacatepay',
      providerRef: `bill_test_${Math.random().toString(36).slice(2, 10)}`,
      brCode: '00020126pixcodetest',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      createdAt: new Date(NOW.getTime() - GRACE_MS - 60_000),
      pixCodeEmailSentAt: null,
    });

    await runPresaleEmailSweepTick({ mailer, env, alertDepth: 200, now: NOW });

    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.html).toContain('00020126pixcodetest');

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.pixCodeEmailSentAt).not.toBeNull();
  });

  // Teste 5: código Pix já vencido. Não serve mais para pagar, então a
  // varredura não deve enviar.
  it('não envia o código Pix de um pedido com código já vencido', async () => {
    const order = await seedBaseOrder({
      status: 'pending',
      method: 'pix',
      provider: 'abacatepay',
      providerRef: `bill_test_${Math.random().toString(36).slice(2, 10)}`,
      brCode: '00020126pixcodetest',
      expiresAt: new Date(NOW.getTime() - 60_000),
      createdAt: new Date(NOW.getTime() - GRACE_MS - 60_000),
      pixCodeEmailSentAt: null,
    });

    await runPresaleEmailSweepTick({ mailer, env, alertDepth: 200, now: NOW });

    expect(mailer.captured).toHaveLength(0);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.pixCodeEmailSentAt).toBeNull();
  });

  // Teste 6: pedido que não é de pré-venda. A varredura nem deve olhar —
  // nenhum email, confirmação ou Pix, sai para ele.
  it('ignora pedido que não é de pré-venda', async () => {
    await seedBaseOrder({
      origin: 'app',
      status: 'paid',
      paidAt: new Date(NOW.getTime() - GRACE_MS - 60_000),
      confirmationEmailSentAt: null,
      method: 'pix',
      provider: 'abacatepay',
      providerRef: `bill_test_${Math.random().toString(36).slice(2, 10)}`,
      brCode: '00020126pixcodetest',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      createdAt: new Date(NOW.getTime() - GRACE_MS - 60_000),
      pixCodeEmailSentAt: null,
    });

    await runPresaleEmailSweepTick({ mailer, env, alertDepth: 200, now: NOW });

    expect(mailer.captured).toHaveLength(0);
  });
});
