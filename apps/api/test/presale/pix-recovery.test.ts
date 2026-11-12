// Recuperação tardia (workers/pix-reconcile.ts) para a pré-venda Casa In Box.
//
// A decisão central da spec: quem paga o Pix DEPOIS da janela de uma hora
// ainda recebe a caixa. A pré-venda não reserva estoque no checkout (débito
// só na liquidação, services/orders/settle.ts: debitPresaleStock), então ao
// contrário do carrinho — onde order-expiry.ts já devolveu a reserva e
// liquidar tarde revenderia o que voltou à prateleira — aqui não há nada para
// revender. O convidado da pré-venda também não tem conta: não há `userId`
// para push, então o aviso tem que ser o email de confirmação
// (sendPresaleConfirmationEmail), o mesmo que o webhook já envia.
import { prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay, type FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { DevMailer } from '../../src/services/mailer/dev.js';
import type { DevPushSender } from '../../src/services/push/dev.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { runPixReconcileTick } from '../../src/workers/pix-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';

const env = loadEnv();
const CHECKOUT_URL = '/presale/casa-in-box/checkout';

describe('recuperação tardia de pré-venda (pix-reconcile)', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;
  let counter = 0;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({ enabled: true, shippingFeeCents: 1990 });

    abacatepay = buildFakeAbacatePay();
    app = await buildApp(env, { stripe: buildFakeStripe(), abacatepay });
  });

  afterEach(async () => {
    await app.close();
  });

  /** Cria o pedido pelo endpoint público de pré-venda, pagamento Pix. */
  const seedPresalePixOrder = async (opts: { quantity?: number; priceCents?: number } = {}) => {
    const quantity = opts.quantity ?? 2;
    const priceCents = opts.priceCents ?? 9900;
    const product = await createPresaleProduct(
      { allowPickup: true, allowShip: true },
      { variants: [{ priceCents, quantityTotal: 10 }] },
    );
    const variantId = product.variants[0]!.id;

    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        clientRequestId: `req-pix-recovery-${++counter}-${Math.random().toString(36).slice(2, 10)}`,
        expectedTotalCents: priceCents * quantity,
        fulfillmentMethod: 'pickup',
        paymentMethod: 'pix',
        items: [{ variantId, quantity }],
        guest: { name: 'Comprador Tardio', email: 'comprador.tardio@exemplo.com' },
        acceptedTermsVersion: 'terms-2026-01-01',
        acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`checkout pix de pré-venda falhou: ${res.statusCode} ${res.body}`);
    }
    const body = res.json() as { orderId: string };
    return prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
  };

  /** Marca o pedido como localmente expirado, como order-expiry.ts já teria
   * feito depois da janela de uma hora, sem depender de rodar o worker. */
  const expireLocally = (orderId: string) =>
    prisma.order.update({ where: { id: orderId }, data: { status: 'expired' } });

  // Mesmo fixture de ticket usado em test/workers/pix-reconcile.test.ts, para
  // provar que o caminho de ingresso (push, não email) não mudou.
  const makePendingTicketPixOrder = async (providerRef: string, createdAt: Date) => {
    const { user } = await createUser({
      email: `pix-ticket-recovery-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    });
    const event = await prisma.event.create({
      data: {
        slug: `evt-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: 'JDM Encontro de Recuperação',
        description: 'd',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600_000),
        type: 'meeting',
        status: 'published',
        capacity: 100,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 5000, quantityTotal: 100 },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        status: 'pending',
        providerRef,
        createdAt,
      },
      select: { id: true },
    });
    return { user, event, order };
  };

  it('pedido expirado localmente e pago no provedor vira paid', async () => {
    const order = await seedPresalePixOrder();
    await expireLocally(order.id);
    abacatepay.nextStatus = {
      id: order.providerRef!,
      status: 'PAID',
      paidAt: new Date().toISOString(),
    };
    const push = app.push as DevPushSender;

    await runPixReconcileTick({
      abacatepay,
      push,
      mailer: app.mailer,
      env: app.env,
      alertDepth: 200,
      now: new Date(order.createdAt.getTime() + 5 * 60 * 1000),
      log: app.log,
    });

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');
    expect(updated.paidAt).not.toBeNull();

    // Review Focus 1 — a decisão central da spec: NÃO pode ter caído no
    // caminho de alerta de "manual refund needed" (expired-but-paid), que é
    // o caminho certo só quando o pedido reservou e já teve a reserva
    // liberada — o que não é o caso da pré-venda.
    const flag = await prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: 'abacatepay',
          eventId: `pix-reconcile:expired-but-paid:${order.id}`,
        },
      },
    });
    expect(flag).toBeNull();
  });

  it('a recuperação envia email ao comprador, não só alerta interno', async () => {
    const order = await seedPresalePixOrder();
    await expireLocally(order.id);
    abacatepay.nextStatus = {
      id: order.providerRef!,
      status: 'PAID',
      paidAt: new Date().toISOString(),
    };
    const push = app.push as DevPushSender;
    const mailer = app.mailer as DevMailer;
    // O checkout já disparou o email do código Pix; zera para isolar o email
    // de confirmação que a recuperação tardia deve enviar.
    mailer.clear();

    await runPixReconcileTick({
      abacatepay,
      push,
      mailer: app.mailer,
      env: app.env,
      alertDepth: 200,
      now: new Date(order.createdAt.getTime() + 5 * 60 * 1000),
      log: app.log,
    });

    // Convidado de pré-venda não tem conta, logo não tem userId: push é
    // impossível por construção. O aviso tem que ser email.
    expect(push.captured).toHaveLength(0);
    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]!.to).toBe('comprador.tardio@exemplo.com');

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.confirmationEmailSentAt).not.toBeNull();
  });

  it('pedido de ingresso continua recebendo push, sem mudança', async () => {
    const createdAt = new Date();
    const providerRef = `pix_char_recovery_ticket_${Math.random().toString(36).slice(2, 10)}`;
    const { user, event, order } = await makePendingTicketPixOrder(providerRef, createdAt);
    await prisma.deviceToken.create({
      data: {
        userId: user.id,
        expoPushToken: 'ExponentPushToken[pix-recovery-1111]',
        platform: 'ios',
      },
    });
    abacatepay.nextStatus = {
      id: providerRef,
      status: 'PAID',
      paidAt: new Date().toISOString(),
    };
    const push = app.push as DevPushSender;
    const mailer = app.mailer as DevMailer;
    mailer.clear();

    await runPixReconcileTick({
      abacatepay,
      push,
      mailer: app.mailer,
      env: app.env,
      alertDepth: 200,
      now: new Date(createdAt.getTime() + 5 * 60 * 1000),
      log: app.log,
    });

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('paid');

    expect(push.captured).toHaveLength(1);
    expect(push.captured[0]?.title).toBe('Pagamento confirmado');
    expect(push.captured[0]?.body).toContain(event.title);
    expect(mailer.captured).toHaveLength(0);
  });
});
