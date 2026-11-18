import { ensurePresaleSystemUser, prisma } from '@ccc/db';
import { presaleOrderStatusUrl } from '@ccc/shared/presale';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { signQrCode } from '../../src/lib/qr.js';
import { DevMailer } from '../../src/services/mailer/dev.js';
import { sendPresalePixCodeEmail } from '../../src/services/presale/pix-code-email.js';
import { resetDatabase } from '../helpers.js';

import { createPresaleProduct } from './fixtures.js';

const env = loadEnv();

describe('sendPresalePixCodeEmail', () => {
  let mailer: DevMailer;
  let randomSuffix = 0;

  beforeEach(async () => {
    await resetDatabase();
    mailer = new DevMailer();
  });

  afterEach(() => {
    mailer.clear();
  });

  const seedPixOrder = async (overrides: { origin?: 'app' | 'casa_in_box' } = {}) => {
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
        origin: overrides.origin ?? 'casa_in_box',
        amountCents: 19800,
        baseAmountCents: 19800,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: 'BRL',
        method: 'pix',
        provider: 'abacatepay',
        providerRef: `bill_test_${randomSuffix}`,
        brCode: `00020126pixcodetest${randomSuffix}`,
        status: 'pending',
        quantity: 2,
        fulfillmentMethod: 'pickup',
        expiresAt: new Date(Date.now() + 3600_000),
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
    // O carimbo é posto ANTES do envio de propósito: é ele que fecha a corrida
    // de envio duplo. Mas carimbar sem soltar transformaria uma falha
    // transitória do mailer em perda definitiva do email — e é por causa deste
    // email que a janela do Pix é de 1 hora e não de 15 minutos.
    const order = await seedPixOrder();

    const brokenMailer = {
      send: () => Promise.reject(new Error('mailer fora do ar')),
    };

    const failed = await sendPresalePixCodeEmail(order.id, {
      mailer: brokenMailer as never,
      env,
      log: { warn: () => {}, error: () => {} } as never,
    });

    expect(failed).toBe(false);

    // A reivindicação foi solta: sem isso o `where: { pixCodeEmailSentAt: null }`
    // nunca mais casaria e a retentativa abaixo seria impossível.
    const afterFailure = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterFailure.pixCodeEmailSentAt).toBeNull();

    // A asserção que importa: a segunda chamada envia DE VERDADE. Sem ela o
    // teste provaria só que a primeira falhou, não que a retentativa funciona.
    const retried = await sendPresalePixCodeEmail(order.id, { mailer, env, log: console as never });

    expect(retried).toBe(true);
    expect(mailer.captured).toHaveLength(1);
  });

  it('envia uma vez e marca pixCodeEmailSentAt', async () => {
    const order = await seedPixOrder();

    const sent = await sendPresalePixCodeEmail(order.id, { mailer, env, log: console as never });

    expect(sent).toBe(true);
    expect(mailer.captured).toHaveLength(1);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.pixCodeEmailSentAt).not.toBeNull();
  });

  it('segunda chamada não reenvia', async () => {
    const order = await seedPixOrder();

    const firstSend = await sendPresalePixCodeEmail(order.id, {
      mailer,
      env,
      log: console as never,
    });
    const secondSend = await sendPresalePixCodeEmail(order.id, {
      mailer,
      env,
      log: console as never,
    });

    expect(firstSend).toBe(true);
    expect(secondSend).toBe(false);
    expect(mailer.captured).toHaveLength(1);
  });

  it('o email contém o brCode e o link de status do pedido', async () => {
    const order = await seedPixOrder();

    await sendPresalePixCodeEmail(order.id, { mailer, env, log: console as never });

    expect(mailer.captured).toHaveLength(1);
    const email = mailer.captured[0]!;
    expect(email.to).toBe('comprador@exemplo.com');
    expect(email.html).toContain(order.brCode!);

    const token = signQrCode('p', order.id, env);
    const statusLink = presaleOrderStatusUrl(env.GARAGE_WEB_BASE_URL, order.id, token);
    // O href escapa '&' pra '&amp;' (mesma convenção de confirmation-email.ts).
    expect(email.html).toContain(statusLink.replace(/&/g, '&amp;'));
  });

  it('não envia para pedido que não é de pré-venda', async () => {
    const order = await seedPixOrder({ origin: 'app' });

    const sent = await sendPresalePixCodeEmail(order.id, { mailer, env, log: console as never });

    expect(sent).toBe(false);
    expect(mailer.captured).toHaveLength(0);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.pixCodeEmailSentAt).toBeNull();
  });
});
