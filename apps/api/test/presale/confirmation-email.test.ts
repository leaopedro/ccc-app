import { ensurePresaleSystemUser, prisma } from '@ccc/db';
import { presaleOrderStatusUrl } from '@ccc/shared/presale';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { signQrCode } from '../../src/lib/qr.js';
import { DevMailer } from '../../src/services/mailer/dev.js';
import { sendPresaleConfirmationEmail } from '../../src/services/presale/confirmation-email.js';
import { resetDatabase } from '../helpers.js';

import { createPresaleProduct } from './fixtures.js';

const env = loadEnv();

// I2 (review final do branch Pix): esta branch tornou este email o ÚNICO
// canal de confirmação do comprador de Pix (o convidado da pré-venda não tem
// conta, logo não há push) e dobrou os call sites (webhook Pix + pix-
// reconcile, além dos já existentes do cartão). O risco de uma falha de
// envio carimbar e nunca soltar deixou de ser o risco secundário que era
// quando só o cartão usava este caminho. Mesmo formato de
// pix-code-email.test.ts.
describe('sendPresaleConfirmationEmail', () => {
  let mailer: DevMailer;
  let randomSuffix = 0;

  beforeEach(async () => {
    await resetDatabase();
    mailer = new DevMailer();
  });

  afterEach(() => {
    mailer.clear();
  });

  const seedOrder = async () => {
    const systemUserId = await ensurePresaleSystemUser();
    const product = await createPresaleProduct(
      { allowPickup: true, allowShip: true },
      { variants: [{ priceCents: 9900, quantityTotal: 10 }] },
    );
    const variantId = product.variants[0]!.id;
    randomSuffix += 1;

    const order = await prisma.order.create({
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
        providerRef: `pi_test_${randomSuffix}`,
        status: 'paid',
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
      },
    });

    return order;
  };

  it('mailer falhando solta o carimbo, e a chamada seguinte ENVIA', async () => {
    // O carimbo é posto ANTES do envio de propósito: é ele que fecha a
    // corrida de envio duplo entre os dois eventos do mesmo pagamento. Mas
    // carimbar sem soltar transformaria uma falha transitória do mailer em
    // perda definitiva do ÚNICO aviso que um comprador de Pix recebe.
    const order = await seedOrder();

    const brokenMailer = {
      send: () => Promise.reject(new Error('mailer fora do ar')),
    };

    const failed = await sendPresaleConfirmationEmail(order.id, {
      mailer: brokenMailer as never,
      env,
      log: { warn: () => {}, error: () => {} } as never,
    });

    expect(failed).toBe(false);

    // A reivindicação foi solta: sem isso o `where: { confirmationEmailSentAt:
    // null }` nunca mais casaria e a retentativa abaixo seria impossível.
    const afterFailure = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterFailure.confirmationEmailSentAt).toBeNull();

    // A asserção que importa: a segunda chamada envia DE VERDADE.
    const retried = await sendPresaleConfirmationEmail(order.id, {
      mailer,
      env,
      log: console as never,
    });

    expect(retried).toBe(true);
    expect(mailer.captured).toHaveLength(1);
  });

  it('envia uma vez e marca confirmationEmailSentAt', async () => {
    const order = await seedOrder();

    const sent = await sendPresaleConfirmationEmail(order.id, {
      mailer,
      env,
      log: console as never,
    });

    expect(sent).toBe(true);
    expect(mailer.captured).toHaveLength(1);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.confirmationEmailSentAt).not.toBeNull();
  });

  it('segunda chamada não reenvia', async () => {
    const order = await seedOrder();

    const firstSend = await sendPresaleConfirmationEmail(order.id, {
      mailer,
      env,
      log: console as never,
    });
    const secondSend = await sendPresaleConfirmationEmail(order.id, {
      mailer,
      env,
      log: console as never,
    });

    expect(firstSend).toBe(true);
    expect(secondSend).toBe(false);
    expect(mailer.captured).toHaveLength(1);
  });

  it('o email contém o link de status do pedido', async () => {
    const order = await seedOrder();

    await sendPresaleConfirmationEmail(order.id, { mailer, env, log: console as never });

    expect(mailer.captured).toHaveLength(1);
    const email = mailer.captured[0]!;
    expect(email.to).toBe('comprador@exemplo.com');

    const token = signQrCode('p', order.id, env);
    const statusLink = presaleOrderStatusUrl(env.GARAGE_WEB_BASE_URL, order.id, token);
    // O href escapa '&' pra '&amp;' (mesma convenção de pix-code-email.ts).
    expect(email.html).toContain(statusLink.replace(/&/g, '&amp;'));
  });
});
